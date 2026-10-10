/**
 * Camera Roll Routes — /api/v1/camera-roll
 * =========================================
 * Foto yang diambil via CameraX browser, disimpan ke Cloudinary,
 * metadata disimpan ke sheet CAMERA_ROLL.
 * Bisa di-assign ke listing kapan saja (Listing_ID awalnya kosong).
 */
const express       = require('express');
const router        = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

// ── helper: baris sheet → object ──────────────────────────
const toObj = r => COLUMNS.CAMERA_ROLL.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});

// ── GET /camera-roll ──────────────────────────────────────
// Query: ?unassigned=true  → hanya yang belum di-assign ke listing
//        ?listing_id=xxx   → foto yang sudah assign ke listing tertentu
router.get('/', async (req, res) => {
  try {
    const { id: agentId, role } = req.user;
    const { unassigned, listing_id } = req.query;

    const rows = await sheetsService.getRange(SHEETS.CAMERA_ROLL);
    if (!rows || rows.length <= 1) return res.json({ data: [] });

    let photos = rows.slice(1).map(toObj).filter(p => p.ID); // skip baris yang sudah dihapus (dikosongkan)

    // Filter per agen (superadmin/admin bisa lihat semua)
    if (!['superadmin', 'admin'].includes(role)) {
      photos = photos.filter(p => p.Agent_ID === agentId);
    }

    if (unassigned === 'true') {
      photos = photos.filter(p => !p.Listing_ID);
    } else if (listing_id) {
      photos = photos.filter(p => p.Listing_ID === listing_id);
    }

    // Urutkan terbaru dulu
    photos.sort((a, b) => new Date(b.Created_At || 0) - new Date(a.Created_At || 0));

    res.json({ data: photos });
  } catch (e) {
    console.error('[CameraRoll] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /camera-roll ─────────────────────────────────────
// Body: { foto_url, cloudinary_id, sesi_label? }
router.post('/', async (req, res) => {
  try {
    const { id: agentId, nama: agentNama } = req.user;
    const { foto_url, cloudinary_id, sesi_label = '' } = req.body;

    if (!foto_url) return res.status(400).json({ error: 'foto_url required' });

    const now    = new Date();
    const tgl    = now.toISOString().substring(0, 10);
    const newRow = [
      uuidv4(),
      agentId,
      agentNama || '',
      sesi_label,
      foto_url,
      cloudinary_id || '',
      '',   // Listing_ID — kosong
      '',   // Listing_Judul — kosong
      tgl,
      now.toISOString(),
    ];

    await sheetsService.appendRow(SHEETS.CAMERA_ROLL, newRow);
    const id = newRow[0];

    res.status(201).json({ data: { id, foto_url, sesi_label, tanggal: tgl } });
  } catch (e) {
    console.error('[CameraRoll] POST error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /camera-roll/:id ────────────────────────────────
// Assign / update label sesi
// Body: { listing_id?, listing_judul?, sesi_label? }
router.patch('/:id', async (req, res) => {
  try {
    const { id: agentId, role } = req.user;
    const { id }   = req.params;
    const { listing_id, listing_judul, sesi_label } = req.body;

    const rows = await sheetsService.getRange(SHEETS.CAMERA_ROLL);
    if (!rows || rows.length <= 1) return res.status(404).json({ error: 'Foto tidak ditemukan' });

    const rowIdx = rows.slice(1).findIndex(r => r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Foto tidak ditemukan' });

    const photo = toObj(rows[rowIdx + 1]);

    // Hanya pemilik / superadmin / admin yang bisa edit
    if (!['superadmin', 'admin'].includes(role) && photo.Agent_ID !== agentId) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Update field yang dikirim
    const updated = { ...photo };
    if (listing_id   !== undefined) updated.Listing_ID    = listing_id;
    if (listing_judul !== undefined) updated.Listing_Judul = listing_judul;
    if (sesi_label   !== undefined) updated.Sesi_Label    = sesi_label;

    const newRow = COLUMNS.CAMERA_ROLL.map(c => updated[c] || '');
    await sheetsService.updateRow(SHEETS.CAMERA_ROLL, rowIdx + 2, newRow); // +2: 1-based + header

    res.json({ data: updated });
  } catch (e) {
    console.error('[CameraRoll] PATCH error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /camera-roll/:id ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id: agentId, role } = req.user;
    const { id } = req.params;

    const rows = await sheetsService.getRange(SHEETS.CAMERA_ROLL);
    if (!rows || rows.length <= 1) return res.status(404).json({ error: 'Foto tidak ditemukan' });

    const rowIdx = rows.slice(1).findIndex(r => r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Foto tidak ditemukan' });

    const photo = toObj(rows[rowIdx + 1]);
    if (!['superadmin', 'admin'].includes(role) && photo.Agent_ID !== agentId) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Hapus baris (isi dengan kosong — pattern yang dipakai di proyek ini)
    const emptyRow = new Array(COLUMNS.CAMERA_ROLL.length).fill('');
    await sheetsService.updateRow(SHEETS.CAMERA_ROLL, rowIdx + 2, emptyRow);

    res.json({ message: 'Foto dihapus dari roll' });
  } catch (e) {
    console.error('[CameraRoll] DELETE error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
