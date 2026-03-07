/**
 * Dashboard Routes — /api/v1/dashboard
 * ============================================
 * Stats disesuaikan per role:
 * - agen:             data sendiri
 * - business_manager: data tim sendiri
 * - principal:        data semua tim
 * - admin/superadmin: semua data
 */
const express       = require('express');
const router        = express.Router();
const sheetsService = require('../services/sheets.service');
const tasksService  = require('../services/tasks.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

// ── GET /dashboard/stats ──────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { role, id, team_id } = req.user;

    const [listRows, leadRows] = await Promise.all([
      sheetsService.getRange(SHEETS.LISTING),
      sheetsService.getRange(SHEETS.LEADS),
    ]);

    const allListings = listRows.slice(1).map(r =>
      COLUMNS.LISTING.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );
    const allLeads = leadRows.slice(1).map(r =>
      COLUMNS.LEADS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );

    // Role-based filter
    let listings = allListings;
    let leads    = allLeads;

    if (role === 'agen') {
      listings = allListings.filter(l => l.Agen_ID === id);
      leads    = allLeads.filter(l => l.Agen_ID === id);
    } else if (role === 'business_manager') {
      if (team_id) {
        listings = allListings.filter(l => l.Team_ID === team_id);
        leads    = allLeads.filter(l => l.Team_ID === team_id);
      }
    } else if (role === 'principal') {
      const myTeamIds = await getMyTeamIds(id);
      if (myTeamIds.length > 0) {
        listings = allListings.filter(l => myTeamIds.includes(l.Team_ID));
        leads    = allLeads.filter(l => myTeamIds.includes(l.Team_ID));
      }
    }
    // admin & superadmin: semua

    const taskSummary = await tasksService.getSummary(role === 'agen' ? id : null);
    const conversionData = tasksService.getConversionStats(leads);
    const funnel = conversionData;
    const thisMonth = new Date().toISOString().substring(0, 7);

    // Unread notifications count
    let unreadNotif = 0;
    try {
      const notifRows = await sheetsService.getRange(SHEETS.NOTIFICATIONS);
      if (notifRows.length > 1) {
        const notifs = notifRows.slice(1).map(r =>
          COLUMNS.NOTIFICATIONS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
        );
        unreadNotif = notifs.filter(n =>
          n.Is_Read !== 'TRUE' &&
          (n.To_User_ID === id || n.To_Role === 'all' || n.To_Role === role)
        ).length;
      }
    } catch (_) {}

    const stats = {
      totalListings:  listings.length,
      activeListings: listings.filter(l => l.Status_Listing === 'Aktif').length,
      listingsOnWeb:  listings.filter(l => l.Tampilkan_di_Web === 'TRUE').length,
      totalLeads:     leads.length,
      hotLeads:       leads.filter(l => l.Score === 'Hot').length,
      warmLeads:      leads.filter(l => l.Score === 'Warm').length,
      newLeads:       leads.filter(l => l.Status_Lead === 'Baru').length,
      buyerRequests:  leads.filter(l => l.Is_Buyer_Request === 'TRUE').length,
      dealsThisMonth: leads.filter(l => l.Status_Lead === 'Deal' && l.Updated_At?.startsWith(thisMonth)).length,
      tasks:          taskSummary,
      funnel:         funnel.stages,
      overall_conversion:   conversionData.overall_cr,
      qualified_conversion: conversionData.qualified_cr,
      selesai_leads:        conversionData.selesai,
      unreadNotif,
      hotLeadsList: leads
        .filter(l => l.Score === 'Hot' && !['Deal','Batal'].includes(l.Status_Lead))
        .sort((a, b) => new Date(a.Next_Follow_Up||0) - new Date(b.Next_Follow_Up||0))
        .slice(0, 8)
        .map(l => ({
          id:             l.ID,
          nama:           l.Nama,
          no_wa:          role === 'agen' ? l.No_WA : '***',
          sumber:         l.Sumber,
          status:         l.Status_Lead,
          budget_max:     l.Budget_Max,
          properti:       l.Properti_Diminati,
          next_follow_up: l.Next_Follow_Up,
          is_buyer_request: l.Is_Buyer_Request === 'TRUE',
          days_since_contact: l.Last_Contact
            ? Math.floor((Date.now() - new Date(l.Last_Contact)) / 86400000)
            : null,
        })),
    };

    res.json({ success: true, data: stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /dashboard/cache/clear ───────────────────────────
router.post('/cache/clear', async (req, res) => {
  try {
    sheetsService.clearCache();
    res.json({ success: true, message: 'Cache berhasil dibersihkan' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GET /dashboard/config ─────────────────────────────────
router.get('/config', (req, res) => {
  res.json({ success: true, data: {
    komisi_form_url: process.env.KOMISI_FORM_URL || '',
    role: req.user.role,
  }});
});

// ── Helpers ───────────────────────────────────────────────
async function getMyTeamIds(principalId) {
  try {
    const rows = await sheetsService.getRange(SHEETS.TEAMS);
    if (rows.length < 2) return [];
    return rows.slice(1)
      .map(r => ({ Team_ID: r[0], Principal_ID: r[2] }))
      .filter(t => t.Principal_ID === principalId)
      .map(t => t.Team_ID);
  } catch { return []; }
}

module.exports = router;
