/**
 * WAG Autopost Routes — Admin/Principal only
 * ==========================================
 * POST /api/v1/wag/pair          → Minta pairing code
 * GET  /api/v1/wag/status        → Status koneksi
 * GET  /api/v1/wag/groups        → List semua WAG (saat connected)
 * GET  /api/v1/wag/config        → Ambil config WAG aktif
 * POST /api/v1/wag/config        → Simpan config WAG
 * DELETE /api/v1/wag/disconnect  → Putus koneksi & reset session
 */

const express  = require('express');
const router   = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const wagService = require('../services/wag-autopost.service');

// Semua role ini boleh lihat status + connect + test
const ALLOWED  = ['superadmin', 'principal', 'admin', 'kantor'];
// Hanya manager yang boleh disconnect + simpan config grup
const MANAGERS = ['superadmin', 'principal'];

function requireRole(req, res, next) {
  if (!ALLOWED.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  next();
}

function requireManager(req, res, next) {
  if (!MANAGERS.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Hanya Principal/Superadmin yang dapat melakukan aksi ini' });
  }
  next();
}

// ── Connect (load session GCS, jangan hapus session) ─────────

router.post('/connect', authMiddleware, requireRole, async (req, res) => {
  try {
    const result = await wagService.connect();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── QR Code (lebih reliable untuk WA Business) ───────────────

router.post('/qr', authMiddleware, requireRole, async (req, res) => {
  try {
    const result = await wagService.requestQR();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Pairing Code ──────────────────────────────────────────────

router.post('/pair', authMiddleware, requireRole, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'phone wajib diisi' });
  try {
    const result = await wagService.requestPairingCode(phone);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Status ────────────────────────────────────────────────────

router.get('/status', authMiddleware, requireRole, (req, res) => {
  res.json({ success: true, ...wagService.getStatus() });
});

// ── List Groups (butuh connected) ─────────────────────────────

router.get('/groups', authMiddleware, requireRole, async (req, res) => {
  try {
    const groups = await wagService.getGroups();
    res.json({ success: true, groups });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// ── Config WAG ────────────────────────────────────────────────

router.get('/config', authMiddleware, requireRole, async (req, res) => {
  try {
    const config = await wagService.getConfig();
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/config', authMiddleware, requireManager, async (req, res) => {
  const { groups } = req.body;
  if (!Array.isArray(groups)) {
    return res.status(400).json({ success: false, message: 'groups harus array' });
  }
  try {
    const result = await wagService.saveConfig(groups);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Manual Test Post (fire-and-forget) ───────────────────────
// Return segera — sender-key distribution ke grup besar bisa >5 menit
// Hasil bisa dilihat di WAG grup langsung atau di sheet WAG_POST_LOG

router.post('/test', authMiddleware, requireRole, (req, res) => {
  const { type } = req.body;
  res.json({ success: true, message: 'autoPost dimulai — periksa grup WAG dalam beberapa menit' });
  wagService.autoPost(type)
    .then(r  => console.log('[WAG] Test autoPost selesai:', JSON.stringify(r)))
    .catch(e => console.error('[WAG] Test autoPost error:', e.message));
});

// ── Disconnect ────────────────────────────────────────────────

router.delete('/disconnect', authMiddleware, requireManager, async (req, res) => {
  try {
    await wagService.disconnect();
    res.json({ success: true, message: 'WAG bot terputus dan session dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
