/**
 * Knowledge Routes — /api/v1/knowledge
 * ============================================
 * Endpoints:
 *   GET  /docs              → List dokumen aktif (semua role)
 *   GET  /docs/all          → List semua dokumen incl. Draft (admin+)
 *   POST /docs              → Tambah dokumen baru (admin+)
 *   PUT  /docs/:id          → Update dokumen (admin+)
 *   DELETE /docs/:id        → Nonaktifkan dokumen (admin+)
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const kSvc = require('../services/knowledge.service');

const MANAGE_ROLES = ['superadmin', 'principal', 'kantor', 'admin'];

router.use(authMiddleware);

// ── GET /docs — semua role bisa lihat dokumen aktif
router.get('/docs', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { docs, error } = await kSvc.getDocs({ includeAll: false });
    if (error && !docs.length) return res.status(503).json({ success: false, message: error });
    res.json({ success: true, data: docs });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /docs/all — admin+ saja
router.get('/docs/all', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    const { docs, error } = await kSvc.getDocs({ includeAll: true });
    if (error && !docs.length) return res.status(503).json({ success: false, message: error });
    res.json({ success: true, data: docs });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /docs — tambah dokumen baru
router.post('/docs', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    const doc = await kSvc.addDoc(req.body);
    res.status(201).json({ success: true, data: doc });
  } catch(e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// ── PUT /docs/:id — update dokumen
router.put('/docs/:id', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    const doc = await kSvc.updateDoc(req.params.id, req.body);
    res.json({ success: true, data: doc });
  } catch(e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// ── DELETE /docs/:id — nonaktifkan (set Draft)
router.delete('/docs/:id', async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    await kSvc.deleteDoc(req.params.id);
    res.json({ success: true, message: 'Dokumen dinonaktifkan' });
  } catch(e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

module.exports = router;
