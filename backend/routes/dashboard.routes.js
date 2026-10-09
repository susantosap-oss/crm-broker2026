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
// ── Helper: hitung satu blok stats dari subset listing+leads+shareCount ──
function _computeBlock(listings, leads, totalShareListing) {
  const conv  = tasksService.getConversionStats(leads);
  const aktif = listings.filter(l => l.Status_Listing === 'Aktif');
  return {
    activeListings:       aktif.length,
    totalListings:        listings.length,
    jualListings:         aktif.filter(l => ['Jual','Dijual'].includes(l.Status_Transaksi)).length,
    sewaListings:         aktif.filter(l => ['Sewa','Disewa','Disewakan'].includes(l.Status_Transaksi)).length,
    totalLeads:           leads.length,
    hotLeads:             leads.filter(l => l.Score === 'Hot').length,
    warmLeads:            leads.filter(l => l.Score === 'Warm').length,
    coldLeads:            leads.filter(l => l.Score === 'Cold').length,
    qualified_conversion: conv.qualified_cr,
    overall_conversion:   conv.overall_cr,
    selesai_leads:        conv.selesai,
    funnel:               conv.stages,
    totalShareListing,
  };
}

router.get('/stats', async (req, res) => {
  try {
    const { role, id, team_id } = req.user;
    const isDual = role === 'business_manager' || role === 'principal';

    const fetches = [
      sheetsService.getRange(SHEETS.LISTING),
      sheetsService.getRange(SHEETS.LEADS),
    ];
    if (isDual) fetches.push(sheetsService.getRange(SHEETS.SHARE_LOG));

    const [listRows, leadRows, shareLogRows] = await Promise.all(fetches);

    const allListings = listRows.slice(1).map(r =>
      COLUMNS.LISTING.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );
    const allLeads = leadRows.slice(1).map(r =>
      COLUMNS.LEADS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {})
    );
    const shareLogData = isDual && shareLogRows?.length > 1
      ? shareLogRows.slice(1).map(r => COLUMNS.SHARE_LOG.reduce((o,c,i) => { o[c]=r[i]||''; return o; }, {}))
      : [];

    // Role-based filter (main stats = team scope untuk BM/Principal)
    let listings = allListings;
    let leads    = allLeads;
    let dualStats = null;

    if (role === 'agen' || role === 'koordinator') {
      listings = allListings.filter(l => l.Agen_ID === id);
      leads    = allLeads.filter(l => l.Agen_ID === id);

    } else if (role === 'business_manager') {
      const ownListings  = allListings.filter(l => l.Agen_ID === id);
      const teamListings = team_id ? allListings.filter(l => l.Team_ID === team_id) : ownListings;
      const ownLeads     = allLeads.filter(l => l.Agen_ID === id);
      const teamLeads    = team_id ? allLeads.filter(l => l.Team_ID === team_id) : ownLeads;

      listings = teamListings;
      leads    = teamLeads;

      const ownIds  = new Set(ownListings.map(l => l.ID));
      const teamIds = new Set(teamListings.map(l => l.ID));
      const ownShare  = shareLogData.filter(s => s.Tipe_Konten === 'listing' && ownIds.has(s.Konten_ID)).length;
      const teamShare = shareLogData.filter(s => s.Tipe_Konten === 'listing' && teamIds.has(s.Konten_ID)).length;

      dualStats = {
        own:  _computeBlock(ownListings,  ownLeads,  ownShare),
        team: _computeBlock(teamListings, teamLeads, teamShare),
      };

    } else if (role === 'principal') {
      const myTeamIds    = await getMyTeamIds(id);
      const ownListings  = allListings.filter(l => l.Agen_ID === id);
      const teamListings = myTeamIds.length > 0 ? allListings.filter(l => myTeamIds.includes(l.Team_ID)) : ownListings;
      const ownLeads     = allLeads.filter(l => l.Agen_ID === id);
      const teamLeads    = myTeamIds.length > 0 ? allLeads.filter(l => myTeamIds.includes(l.Team_ID)) : ownLeads;

      listings = teamListings;
      leads    = teamLeads;

      const ownIds  = new Set(ownListings.map(l => l.ID));
      const teamIds = new Set(teamListings.map(l => l.ID));
      const ownShare  = shareLogData.filter(s => s.Tipe_Konten === 'listing' && ownIds.has(s.Konten_ID)).length;
      const teamShare = shareLogData.filter(s => s.Tipe_Konten === 'listing' && teamIds.has(s.Konten_ID)).length;

      dualStats = {
        own:  _computeBlock(ownListings,  ownLeads,  ownShare),
        team: _computeBlock(teamListings, teamLeads, teamShare),
      };
    }
    // admin & superadmin: semua

    const taskSummary = await tasksService.getSummary(['agen','koordinator'].includes(role) ? id : null);
    const conversionData = tasksService.getConversionStats(leads);
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

    const aktifListings = listings.filter(l => l.Status_Listing === 'Aktif');
    const stats = {
      totalListings:  listings.length,
      activeListings: aktifListings.length,
      listingsOnWeb:  listings.filter(l => l.Tampilkan_di_Web === 'TRUE').length,
      jualListings:   aktifListings.filter(l => ['Jual','Dijual'].includes(l.Status_Transaksi)).length,
      sewaListings:   aktifListings.filter(l => ['Sewa','Disewa','Disewakan'].includes(l.Status_Transaksi)).length,
      totalLeads:     leads.length,
      hotLeads:       leads.filter(l => l.Score === 'Hot').length,
      warmLeads:      leads.filter(l => l.Score === 'Warm').length,
      coldLeads:      leads.filter(l => l.Score === 'Cold').length,
      newLeads:       leads.filter(l => l.Status_Lead === 'Baru').length,
      buyerRequests:  leads.filter(l => l.Is_Buyer_Request === 'TRUE').length,
      dealsThisMonth: leads.filter(l => l.Status_Lead === 'Deal' && l.Updated_At?.startsWith(thisMonth)).length,
      tasks:          taskSummary,
      funnel:         conversionData.stages,
      overall_conversion:   conversionData.overall_cr,
      qualified_conversion: conversionData.qualified_cr,
      selesai_leads:        conversionData.selesai,
      unreadNotif,
      dual: dualStats,
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
