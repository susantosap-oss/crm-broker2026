/**
 * Assets Routes — /api/v1/assets
 * ============================================
 * Fitur ASSET: Properti Lelang / Eksekusi Bank
 *
 * Akses view: semua user login
 * Akses edit/create: superadmin | principal | kantor | business_manager | admin + ASSET_EDITORS
 * Akses publish: superadmin | principal | kantor | admin
 * Akses sync: superadmin | principal | kantor
 * Akses delete: superadmin | principal | kantor
 *
 * Endpoints:
 *   GET    /assets             → List semua aset
 *   GET    /assets/:id         → Detail aset
 *   POST   /assets             → Buat aset baru
 *   PUT    /assets/:id         → Update aset
 *   DELETE /assets/:id         → Hapus aset
 *   PATCH  /assets/:id/publish → Toggle Publish/Draft
 *   GET    /assets/:id/bundle  → Caption bundle sosmed
 *   POST   /assets/:id/caption → Regenerate caption
 *   POST   /assets/sync        → Sync dari external GSheet
 *   GET    /assets/editors     → List asset editors
 *   POST   /assets/editors     → Tambah editor
 *   DELETE /assets/editors/:agenId → Hapus editor
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const assetsService = require('../services/assets.service');

// Roles yang selalu bisa edit/manage
const MANAGE_ROLES = ['superadmin', 'principal', 'kantor', 'business_manager', 'admin'];
const PUBLISH_ROLES = ['superadmin', 'principal', 'kantor', 'admin'];
const SYNC_ROLES    = ['superadmin', 'principal', 'kantor'];
const EDITOR_MGMT_ROLES = ['superadmin', 'principal', 'kantor', 'admin'];

router.use(authMiddleware);

// ── Helper: cek apakah user bisa edit ─────────────────────
async function canEdit(user) {
  if (MANAGE_ROLES.includes(user.role)) return true;
  return assetsService.isEditor(user.id);
}

// ── GET / — List aset ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filters = {};
    const { search, status, tipe } = req.query;
    if (search) filters.search = search;
    if (status) filters.status = status;
    if (tipe)   filters.tipe   = tipe;

    // Agen biasa: hanya lihat yang Publish
    if (!MANAGE_ROLES.includes(req.user.role)) {
      const isEd = await assetsService.isEditor(req.user.id);
      if (!isEd) filters.status = 'Publish';
    }

    const assets = await assetsService.getAll(filters);
    res.json({ success: true, data: assets, count: assets.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /editors — List editors ────────────────────────────
router.get('/editors', async (req, res) => {
  try {
    if (!EDITOR_MGMT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const editors = await assetsService.getEditors();
    res.json({ success: true, data: editors });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /editors — Tambah editor ─────────────────────────
router.post('/editors', async (req, res) => {
  try {
    if (!EDITOR_MGMT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const { agen_id, agen_nama } = req.body;
    if (!agen_id) return res.status(400).json({ success: false, message: 'agen_id wajib diisi' });
    const editor = await assetsService.addEditor(agen_id, agen_nama || '', req.user);
    res.status(201).json({ success: true, data: editor, message: `${agen_nama || agen_id} berhasil ditambah sebagai editor aset` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE /editors/:agenId — Hapus editor ─────────────────
router.delete('/editors/:agenId', async (req, res) => {
  try {
    if (!EDITOR_MGMT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    await assetsService.removeEditor(req.params.agenId);
    res.json({ success: true, message: 'Editor berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /sync — Sync dari external sheet ──────────────────
router.post('/sync', async (req, res) => {
  try {
    if (!SYNC_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Hanya Superadmin/Principal/Kantor yang bisa sync data aset' });
    }
    const reset  = req.query.reset === 'true';
    const result = await assetsService.syncFromSource(req.user, reset);
    res.json({ success: true, data: result, message: result.message });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id — Detail aset ─────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const asset = await assetsService.getById(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Aset tidak ditemukan' });
    // Non-editor agen: hanya lihat yang Publish
    if (!MANAGE_ROLES.includes(req.user.role)) {
      const isEd = await assetsService.isEditor(req.user.id);
      if (!isEd && asset.Status !== 'Publish') {
        return res.status(403).json({ success: false, message: 'Aset belum dipublikasikan' });
      }
    }
    res.json({ success: true, data: asset });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST / — Buat aset baru ────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!(await canEdit(req.user))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Anda tidak memiliki hak tambah aset.' });
    }
    if (!req.body.Nama_Asset) {
      return res.status(400).json({ success: false, message: 'Nama Asset wajib diisi' });
    }
    const asset = await assetsService.create(req.body, req.user);
    res.status(201).json({ success: true, data: asset, message: `Aset "${asset.Nama_Asset}" berhasil dibuat` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PUT /:id — Update aset ─────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (!(await canEdit(req.user))) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const asset = await assetsService.update(req.params.id, req.body);
    res.json({ success: true, data: asset, message: 'Aset berhasil diupdate' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE /:id — Hapus aset ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!PUBLISH_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    await assetsService.delete(req.params.id);
    res.json({ success: true, message: 'Aset berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /:id/publish — Toggle Publish/Draft ──────────────
router.patch('/:id/publish', async (req, res) => {
  try {
    if (!PUBLISH_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    const { status } = req.body;
    const asset = await assetsService.setStatus(req.params.id, status);
    res.json({
      success: true,
      data: asset,
      message: `Aset berhasil ${status === 'Publish' ? 'dipublikasikan ke Web ✅' : 'disembunyikan dari Web'}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /:id/bundle — Caption bundle ──────────────────────
router.get('/:id/bundle', async (req, res) => {
  try {
    const asset = await assetsService.getById(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Aset tidak ditemukan' });
    const bundle = assetsService.getSosmedBundle(asset);
    res.json({ success: true, data: bundle });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /:id/caption — Regenerate caption ─────────────────
router.post('/:id/caption', async (req, res) => {
  try {
    const asset = await assetsService.getById(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Aset tidak ditemukan' });
    const newCaption = assetsService.generateCaption(asset, 'instagram');
    await assetsService.update(req.params.id, { Caption_Sosmed: newCaption });
    const bundle = assetsService.getSosmedBundle({ ...asset, Caption_Sosmed: newCaption });
    res.json({ success: true, data: bundle, message: 'Caption berhasil di-generate ulang' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
