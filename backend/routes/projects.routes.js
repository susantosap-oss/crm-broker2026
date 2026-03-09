/**
 * Projects Routes — /api/v1/projects
 * ============================================
 * Fitur PRIMARY: Manajemen proyek properti baru dari developer.
 *
 * Akses: superadmin | principal | admin
 * Agen: READ ONLY (untuk lihat daftar proyek)
 *
 * Endpoints:
 *   GET    /projects              → List semua proyek
 *   GET    /projects/:id          → Detail proyek
 *   POST   /projects              → Buat proyek baru
 *   PUT    /projects/:id          → Update proyek
 *   DELETE /projects/:id          → Hapus proyek
 *   PATCH  /projects/:id/publish  → Toggle status Publish/Draft
 *   GET    /projects/:id/shortlink → Get/create shortlink agen ini
 *   GET    /projects/:id/referrals → Stats klik per agen (principal+)
 *   GET    /projects/:id/bundle    → Sosmed caption bundle
 *   POST   /projects/:id/caption   → Regenerate caption
 *   GET    /p/:kode               → Public redirect shortlink (track klik)
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const projectsService = require('../services/projects.service');

// Roles yang bisa input/edit proyek
const MANAGE_ROLES = ['superadmin', 'principal', 'admin'];

// ── Auth untuk semua internal routes ─────────────────────
router.use(authMiddleware);

// ── GET / — List proyek ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filters = {};
    const { search, status, tipe } = req.query;
    if (search) filters.search = search;
    if (status) filters.status = status;
    if (tipe)   filters.tipe   = tipe;

    // Agen hanya lihat yang Publish
    if (req.user.role === 'agen') filters.status = 'Publish';

    const projects = await projectsService.getAll(filters);
    res.json({ success: true, data: projects, count: projects.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id — Detail proyek ─────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    // Agen hanya lihat yang Publish
    if (req.user.role === 'agen' && project.Status !== 'Publish') {
      return res.status(403).json({ success: false, message: 'Proyek belum dipublikasikan' });
    }
    res.json({ success: true, data: project });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST / — Buat proyek baru ─────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin/principal yang bisa menambah proyek.' });
    }

    const { Nama_Proyek, Nama_Developer, Tipe_Properti } = req.body;
    if (!Nama_Proyek)    return res.status(400).json({ success: false, message: 'Nama Proyek wajib diisi' });
    if (!Nama_Developer) return res.status(400).json({ success: false, message: 'Nama Developer wajib diisi' });
    if (!Tipe_Properti)  return res.status(400).json({ success: false, message: 'Tipe Properti wajib diisi' });

    const project = await projectsService.create(req.body, req.user);
    res.status(201).json({ success: true, data: project, message: `Proyek "${project.Nama_Proyek}" berhasil dibuat` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PUT /:id — Update proyek ─────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const project = await projectsService.update(req.params.id, req.body);
    res.json({ success: true, data: project, message: 'Proyek berhasil diupdate' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE /:id — Hapus proyek ────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    await projectsService.delete(req.params.id);
    res.json({ success: true, message: 'Proyek berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /:id/publish — Toggle Publish/Draft ─────────────
router.patch('/:id/publish', async (req, res) => {
  try {
    if (!MANAGE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const { status } = req.body; // 'Publish' | 'Draft'
    const project = await projectsService.setStatus(req.params.id, status);
    res.json({
      success: true,
      data: project,
      message: `Proyek berhasil ${status === 'Publish' ? 'dipublikasikan ✅' : 'disembunyikan'}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/shortlink — Get/create shortlink untuk agen ini
router.get('/:id/shortlink', async (req, res) => {
  try {
    const ref = await projectsService.getOrCreateShortlink(req.params.id, req.user);
    res.json({ success: true, data: ref });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/referrals — Leaderboard klik per agen ────────
router.get('/:id/referrals', async (req, res) => {
  try {
    if (!['superadmin', 'principal', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const stats = await projectsService.getReferralStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/bundle — Sosmed caption bundle ───────────────
router.get('/:id/bundle', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    const bundle = projectsService.getSosmedBundle(project);
    res.json({ success: true, data: bundle });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /:id/caption — Regenerate caption ────────────────
router.post('/:id/caption', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });

    // Save new caption ke sheet
    const newCaption = projectsService.generateCaption(project, 'instagram');
    await projectsService.update(req.params.id, { Caption_Sosmed: newCaption });

    const bundle = projectsService.getSosmedBundle({ ...project, Caption_Sosmed: newCaption });
    res.json({ success: true, data: bundle, message: 'Caption berhasil di-generate ulang' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
