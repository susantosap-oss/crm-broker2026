const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const trainingSvc = require('../services/training.service');

const UPLOAD_ROLES = ['superadmin', 'principal', 'kantor', 'koordinator'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
  fileFilter(req, file, cb) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Hanya file PDF atau gambar (JPG/PNG) yang diizinkan'));
  },
});

router.use(authMiddleware);

// GET /materials — semua role
router.get('/materials', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await trainingSvc.getTrainingMaterials();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /product-knowledge/upload — upload ke subfolder Product Knowledge
router.post('/product-knowledge/upload', upload.array('files', 20), async (req, res) => {
  if (!UPLOAD_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  const folderName = (req.body.folderName || '').trim();
  if (!folderName) return res.status(400).json({ success: false, message: 'Nama folder wajib diisi' });
  if (!req.files?.length) return res.status(400).json({ success: false, message: 'Minimal 1 file harus dipilih' });

  try {
    const uploaderName = req.user?.nama || req.user?.name || req.user?.id || '';
    const result = await trainingSvc.uploadToProductKnowledge(folderName, req.files, uploaderName);
    res.json({ success: true, message: `${result.uploaded.length} file berhasil diupload`, data: result });
  } catch (e) {
    console.error('[training upload]', e.message, e.code || '', e.status || '');
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /product-knowledge/:id — hapus file PK (upload roles only)
router.delete('/product-knowledge/:id', async (req, res) => {
  if (!UPLOAD_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  try {
    await trainingSvc.deleteProductKnowledgeFile(req.params.id);
    res.json({ success: true, message: 'File berhasil dihapus' });
  } catch (e) {
    console.error('[training delete]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /refresh — invalidate cache (admin+)
router.post('/refresh', async (req, res) => {
  if (!UPLOAD_ROLES.includes(req.user?.role) && !['admin', 'business_manager'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  trainingSvc.clearTrainingCache();
  res.json({ success: true, message: 'Cache cleared' });
});

module.exports = router;
