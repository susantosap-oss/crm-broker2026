/**
 * Leads Routes - /api/v1/leads
 * ============================================
 * Role-based access:
 * - agen:             hanya leads sendiri
 * - business_manager: leads tim sendiri (tanpa No_WA)
 * - principal:        leads semua tim (tanpa No_WA)
 * - admin/superadmin: semua leads
 */

const express = require('express');
const router  = express.Router();
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware, isManager } = require('../middleware/auth.middleware');
const { createNotification } = require('./notifications.routes');
const { v4: uuidv4 } = require('uuid');

router.use(authMiddleware);

function rowToLead(row) {
  return COLUMNS.LEADS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {});
}

// Sembunyikan No_WA untuk BM dan Principal
function maskLead(lead, role) {
  if (['agen', 'admin', 'superadmin'].includes(role)) return lead;
  return { ...lead, No_WA: '***masked***' };
}

// GET /leads
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.LEADS);
    const [, ...data] = rows;
    let leads = data.map(rowToLead).filter(l => l.ID);

    const { role, id, team_id } = req.user;

    // Role-based filter
    if (role === 'agen') {
      leads = leads.filter(l => l.Agen_ID === id);
    } else if (role === 'business_manager') {
      // Lihat leads tim sendiri
      if (team_id) leads = leads.filter(l => l.Team_ID === team_id || l.Agen_ID === id);
      leads = leads.map(l => maskLead(l, role));
    } else if (role === 'principal') {
      // Lihat semua leads tim-timnya
      const myTeams = await getMyTeamIds(id);
      if (myTeams.length > 0) leads = leads.filter(l => myTeams.includes(l.Team_ID) || !l.Team_ID);
      leads = leads.map(l => maskLead(l, role));
    }
    // admin & superadmin: semua leads tanpa filter

    // Query filters
    if (req.query.score)  leads = leads.filter(l => l.Score === req.query.score);
    if (req.query.status) leads = leads.filter(l => l.Status_Lead === req.query.status);
    if (req.query.agen_id) leads = leads.filter(l => l.Agen_ID === req.query.agen_id);
    if (req.query.team_id) leads = leads.filter(l => l.Team_ID === req.query.team_id);
    if (req.query.buyer_request === 'true') leads = leads.filter(l => l.Is_Buyer_Request === 'TRUE');
    if (req.query.limit)  leads = leads.slice(0, parseInt(req.query.limit));

    res.json({ success: true, data: leads, count: leads.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /leads/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.LEADS, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Lead tidak ditemukan' });
    const lead = rowToLead(result.data);
    res.json({ success: true, data: maskLead(lead, req.user.role) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /leads
router.post('/', async (req, res) => {
  try {
    const id  = uuidv4();
    const now = new Date().toISOString();
    const isBuyerRequest = req.body.Is_Buyer_Request === 'TRUE' || req.body.Is_Buyer_Request === true;

    const row = COLUMNS.LEADS.map(col => {
      if (col === 'ID')          return id;
      if (col === 'Tanggal' || col === 'Created_At' || col === 'Updated_At') return now;
      if (col === 'Agen_ID')     return req.user.id;
      if (col === 'Agen_Nama')   return req.user.nama;
      if (col === 'Status_Lead') return 'Baru';
      if (col === 'Team_ID')     return req.user.team_id || '';
      if (col === 'Is_Buyer_Request') return isBuyerRequest ? 'TRUE' : 'FALSE';
      return req.body[col] || '';
    });

    await sheetsService.appendRow(SHEETS.LEADS, row);

    // Kirim notif jika Buyer Request
    if (isBuyerRequest) {
      await createNotification({
        tipe:           'buyer_request',
        judul:          '🔔 Buyer Request Baru!',
        pesan:          `${req.user.nama} menambahkan Buyer Request: ${req.body.Nama || 'Lead baru'} — ${req.body.Properti_Diminati || ''}`,
        from_user_id:   req.user.id,
        from_user_nama: req.user.nama,
        to_role:        'all',
        link_type:      'lead',
        link_id:        id,
      });
    }

    res.status(201).json({ success: true, data: { id }, message: 'Lead berhasil ditambahkan' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /leads/:id
router.patch('/:id', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.LEADS, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Lead tidak ditemukan' });

    const existing = rowToLead(result.data);

    // Agen hanya bisa edit leads sendiri
    if (req.user.role === 'agen' && existing.Agen_ID !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    // Cek jika diubah jadi Buyer Request
    const wasBuyerRequest = existing.Is_Buyer_Request === 'TRUE';
    const nowBuyerRequest = req.body.Is_Buyer_Request === 'TRUE';
    if (!wasBuyerRequest && nowBuyerRequest) {
      await createNotification({
        tipe:           'buyer_request',
        judul:          '🔔 Buyer Request Baru!',
        pesan:          `${req.user.nama} menandai lead ${existing.Nama} sebagai Buyer Request`,
        from_user_id:   req.user.id,
        from_user_nama: req.user.nama,
        to_role:        'all',
        link_type:      'lead',
        link_id:        req.params.id,
      });
    }

    const merged = { ...existing, ...req.body, Updated_At: new Date().toISOString() };

    // Auto-set Tanggal_Dihubungi saat pertama kali status berubah dari 'Baru'
    const wasNew    = existing.Status_Lead === 'Baru';
    const nowNotNew = req.body.Status_Lead && req.body.Status_Lead !== 'Baru';
    if (wasNew && nowNotNew && !existing.Tanggal_Dihubungi) {
      merged.Tanggal_Dihubungi = new Date().toISOString();
    }

    const row = COLUMNS.LEADS.map(col => merged[col] || '');
    await sheetsService.updateRow(SHEETS.LEADS, result.rowIndex, row);
    res.json({ success: true, message: 'Lead berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /leads/:id
router.put('/:id', async (req, res) => {
  try {
    const result = await sheetsService.findRowById(SHEETS.LEADS, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Lead tidak ditemukan' });
    const existing = rowToLead(result.data);
    const merged = { ...existing, ...req.body, Updated_At: new Date().toISOString() };

    // Auto-set Tanggal_Dihubungi saat pertama kali status berubah dari 'Baru'
    if (existing.Status_Lead === 'Baru' && req.body.Status_Lead && req.body.Status_Lead !== 'Baru' && !existing.Tanggal_Dihubungi) {
      merged.Tanggal_Dihubungi = new Date().toISOString();
    }

    const row = COLUMNS.LEADS.map(col => merged[col] || '');
    await sheetsService.updateRow(SHEETS.LEADS, result.rowIndex, row);
    res.json({ success: true, message: 'Lead berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /leads/stats/by-agent — untuk Principal & BM
router.get('/stats/by-agent', async (req, res) => {
  try {
    const { role, id, team_id } = req.user;
    if (!['principal', 'business_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const rows = await sheetsService.getRange(SHEETS.LEADS);
    const [, ...data] = rows;
    let leads = data.map(rowToLead).filter(l => l.ID);

    if (role === 'business_manager' && team_id) {
      leads = leads.filter(l => l.Team_ID === team_id);
    } else if (role === 'principal') {
      const myTeams = await getMyTeamIds(id);
      if (myTeams.length > 0) leads = leads.filter(l => myTeams.includes(l.Team_ID));
    }

    // Group by agen
    const byAgent = {};
    leads.forEach(l => {
      const key = l.Agen_ID;
      if (!byAgent[key]) byAgent[key] = { agen_id: key, agen_nama: l.Agen_Nama, total: 0, hot: 0, deal: 0, baru: 0 };
      byAgent[key].total++;
      if (l.Score === 'Hot') byAgent[key].hot++;
      if (l.Status_Lead === 'Deal') byAgent[key].deal++;
      if (l.Status_Lead === 'Baru') byAgent[key].baru++;
    });

    res.json({ success: true, data: Object.values(byAgent), total: leads.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Helpers ───────────────────────────────────────────────
async function getMyTeamIds(principalId) {
  try {
    const rows = await sheetsService.getRange(SHEETS.TEAMS);
    if (rows.length < 2) return [];
    const [, ...data] = rows;
    return data
      .map(r => ({ Team_ID: r[0], Principal_ID: r[2] }))
      .filter(t => t.Principal_ID === principalId)
      .map(t => t.Team_ID);
  } catch { return []; }
}

module.exports = router;
