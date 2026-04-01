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

router.use(authMiddleware);

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
