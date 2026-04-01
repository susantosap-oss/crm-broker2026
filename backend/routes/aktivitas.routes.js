/**
 * Aktivitas Harian Routes
 * ============================================
 * POST   /aktivitas          — buat aktivitas harian
 * GET    /aktivitas          — list aktivitas (dengan filter tanggal)
 * DELETE /aktivitas/:id      — hapus aktivitas
 */

const express  = require('express');
const router   = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const service  = require('../services/aktivitas.service');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

// GET /aktivitas/tim — aktivitas tim untuk BM / Principal / Kantor
// Query: tanggal=YYYY-MM-DD | week_start=YYYY-MM-DD&week_end=YYYY-MM-DD
router.get('/tim', async (req, res) => {
  try {
    const { role, id } = req.user;
    const { tanggal, week_start, week_end } = req.query;

    if (!['business_manager', 'principal', 'kantor', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    let agenIds = null; // null = semua (kantor / superadmin lihat semua)

    if (role === 'business_manager' || role === 'principal') {
      const rows = await sheetsService.getRange(SHEETS.TEAMS);
      if (rows.length < 2) return res.json({ success: true, data: [] });

      const [, ...teamRows] = rows;
      const myTeams = teamRows
        .map(row => COLUMNS.TEAMS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {}))
        .filter(t => t.Team_ID && t.Status === 'Aktif')
        .filter(t => role === 'business_manager' ? t.BM_ID === id : t.Principal_ID === id);

      if (myTeams.length === 0) return res.json({ success: true, data: [] });

      const idSet = new Set();
      myTeams.forEach(t => {
        try { JSON.parse(t.Member_IDs || '[]').forEach(mid => idSet.add(mid)); } catch {}
        if (t.BM_ID) idSet.add(t.BM_ID);
      });
      agenIds = [...idSet];
      if (agenIds.length === 0) return res.json({ success: true, data: [] });
    }

    const data = await service.getAll({ agenIds, tanggal, week_start, week_end });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /aktivitas
// Query: tanggal=YYYY-MM-DD | week_start=YYYY-MM-DD&week_end=YYYY-MM-DD | agen_id=xxx
router.get('/', async (req, res) => {
  try {
    const { tanggal, week_start, week_end, agen_id: qAgenId } = req.query;
    const { role, id } = req.user;

    // Agen/koordinator hanya bisa lihat milik sendiri
    const agen_id = ['agen', 'koordinator'].includes(role) ? id : (qAgenId || undefined);

    const data = await service.getAll({ agen_id, tanggal, week_start, week_end });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /aktivitas
router.post('/', async (req, res) => {
  try {
    const { tanggal, deskripsi } = req.body;
    if (!deskripsi?.trim()) {
      return res.status(400).json({ success: false, message: 'Deskripsi wajib diisi' });
    }
    // Hanya agen/koordinator yang buat untuk diri sendiri
    // Manager bisa buat atas nama agen lain (untuk keperluan input manual)
    const agen_id   = req.body.agen_id && !['agen','koordinator'].includes(req.user.role)
      ? req.body.agen_id
      : req.user.id;
    const agen_nama = agen_id === req.user.id ? req.user.nama : (req.body.agen_nama || req.user.nama);

    const result = await service.create({ agen_id, agen_nama, tanggal, deskripsi: deskripsi.trim() });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /aktivitas/:id
router.delete('/:id', async (req, res) => {
  try {
    await service.delete(req.params.id, req.user);
    res.json({ success: true, message: 'Aktivitas berhasil dihapus' });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ success: false, message: e.message });
  }
});

module.exports = router;
