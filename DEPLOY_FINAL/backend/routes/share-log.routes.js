/**
 * Share Log Routes — /api/v1/share-log
 * ============================================
 * Mencatat setiap aksi share/hit oleh agen:
 * - Share WA / WA Business (listing & project)
 * - Copy caption IG / TikTok / Facebook / WA (project)
 *
 * Endpoints:
 *   POST /share-log              → Catat 1 share event
 *   GET  /share-log/mine         → Log milik agen sendiri
 *   GET  /share-log/project/:id  → Hit summary per proyek (koordinator/principal/SA)
 *   GET  /share-log/top-projects → Top 5 proyek terbanyak di-hit (principal/SA)
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireMinRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

// Helper row → obj
const toObj = (row) => COLUMNS.SHARE_LOG.reduce((o, col, i) => { o[col] = row[i] || ''; return o; }, {});

// ── Pastikan header sheet ada ─────────────────────────────
async function ensureHeaders() {
  try {
    const rows = await sheetsService.getRange(SHEETS.SHARE_LOG);
    if (!rows || rows.length === 0) {
      await sheetsService.appendRow(SHEETS.SHARE_LOG, COLUMNS.SHARE_LOG);
    }
  } catch (_) {}
}

// ── POST / — Catat share event ────────────────────────────
// Body: { tipe_konten, konten_id, konten_nama, platform, koordinator_id? }
router.post('/', async (req, res) => {
  try {
    await ensureHeaders();

    const { tipe_konten, konten_id, konten_nama, platform, koordinator_id } = req.body;

    const VALID_PLATFORMS = ['wa', 'wa_business', 'instagram', 'tiktok', 'facebook'];
    const VALID_TIPE      = ['listing', 'project'];

    if (!VALID_TIPE.includes(tipe_konten))
      return res.status(400).json({ success: false, message: 'tipe_konten tidak valid' });
    if (!konten_id)
      return res.status(400).json({ success: false, message: 'konten_id wajib diisi' });
    if (!VALID_PLATFORMS.includes(platform))
      return res.status(400).json({ success: false, message: 'platform tidak valid' });

    const row = COLUMNS.SHARE_LOG.map(col => {
      if (col === 'ID')             return uuidv4();
      if (col === 'Timestamp')      return new Date().toISOString();
      if (col === 'Agen_ID')        return req.user.id;
      if (col === 'Agen_Nama')      return req.user.nama || '';
      if (col === 'Tipe_Konten')    return tipe_konten;
      if (col === 'Konten_ID')      return konten_id;
      if (col === 'Konten_Nama')    return konten_nama || '';
      if (col === 'Platform')       return platform;
      if (col === 'Koordinator_ID') return koordinator_id || '';
      return '';
    });

    await sheetsService.appendRow(SHEETS.SHARE_LOG, row);
    res.status(201).json({ success: true, message: 'Share log tercatat' });
  } catch (e) {
    // Jangan gagalkan UI kalau log error — cukup catat di server
    console.error('[ShareLog] Error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /mine — Log milik agen sendiri ───────────────────
router.get('/mine', async (req, res) => {
  try {
    await ensureHeaders();
    const rows = await sheetsService.getRange(SHEETS.SHARE_LOG);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    const { limit = 50, tipe, platform } = req.query;

    let data = rows.slice(1)
      .map(toObj)
      .filter(r => r.Agen_ID === req.user.id);

    if (tipe)     data = data.filter(r => r.Tipe_Konten === tipe);
    if (platform) data = data.filter(r => r.Platform    === platform);

    // Sort terbaru dulu
    data.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    data = data.slice(0, parseInt(limit));

    res.json({ success: true, data, count: data.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /project/:id — Hit summary per proyek ─────────────
// Akses: koordinator proyek, principal, SA, admin
router.get('/project/:id', async (req, res) => {
  try {
    await ensureHeaders();
    const rows = await sheetsService.getRange(SHEETS.SHARE_LOG);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    let data = rows.slice(1)
      .map(toObj)
      .filter(r => r.Tipe_Konten === 'project' && r.Konten_ID === req.params.id);

    // Group by agen
    const agenMap = {};
    data.forEach(r => {
      const key = r.Agen_ID;
      if (!agenMap[key]) agenMap[key] = {
        agen_id:   r.Agen_ID,
        agen_nama: r.Agen_Nama,
        total:     0,
        platforms: {},
        last_share: r.Timestamp,
      };
      agenMap[key].total++;
      agenMap[key].platforms[r.Platform] = (agenMap[key].platforms[r.Platform] || 0) + 1;
      if (r.Timestamp > agenMap[key].last_share) agenMap[key].last_share = r.Timestamp;
    });

    const result = Object.values(agenMap)
      .sort((a, b) => b.total - a.total);

    res.json({ success: true, data: result, total_hits: data.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /top-projects — Top 5 proyek terbanyak di-hit ─────
// Akses: principal, SA, admin
router.get('/top-projects', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.SHARE_LOG);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    const { limit = 5 } = req.query;

    const data = rows.slice(1).map(toObj).filter(r => r.Tipe_Konten === 'project');

    // Group by konten_id
    const projectMap = {};
    data.forEach(r => {
      const key = r.Konten_ID;
      if (!projectMap[key]) projectMap[key] = {
        konten_id:   r.Konten_ID,
        konten_nama: r.Konten_Nama,
        total:       0,
        agen_set:    {},
      };
      projectMap[key].total++;
      projectMap[key].agen_set[r.Agen_ID] = r.Agen_Nama;
    });

    const result = Object.values(projectMap)
      .map(p => ({
        ...p,
        agen_list: Object.entries(p.agen_set).map(([id, nama]) => ({ id, nama })),
        agen_set: undefined,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, parseInt(limit));

    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /summary — Ringkasan share agen sendiri ────────────
// Dipakai di dashboard koordinator
router.get('/summary', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.SHARE_LOG);
    if (!rows || rows.length < 2) {
      return res.json({ success: true, data: { total: 0, by_platform: {}, by_tipe: {} } });
    }

    const data = rows.slice(1)
      .map(toObj)
      .filter(r => r.Agen_ID === req.user.id);

    const by_platform = {};
    const by_tipe     = {};
    data.forEach(r => {
      by_platform[r.Platform]    = (by_platform[r.Platform]    || 0) + 1;
      by_tipe[r.Tipe_Konten]     = (by_tipe[r.Tipe_Konten]     || 0) + 1;
    });

    res.json({ success: true, data: { total: data.length, by_platform, by_tipe } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
