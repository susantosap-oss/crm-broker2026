/**
 * Canvasing Routes — /api/v1/canvasing
 * Mencari listing baru dari lapangan.
 *
 * GET  /canvasing          — list (role-based)
 * POST /canvasing          — tambah baru
 * PATCH /canvasing/:id     — update (hasil, FU, status, listing_id)
 */

const express        = require('express');
const router         = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService  = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

function rowToObj(row) {
  return COLUMNS.CANVASING.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// ── GET /canvasing ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.CANVASING);
    const [, ...data] = rows;
    let records = data.map(rowToObj).filter(r => r.ID);

    const { role, id } = req.user;
    // Principal & superadmin lihat semua, role lain hanya milik sendiri
    if (!['principal', 'superadmin'].includes(role)) {
      records = records.filter(r => r.Agen_ID === id);
    }

    // Filter query params
    if (req.query.hasil) records = records.filter(r => r.Hasil === req.query.hasil);
    if (req.query.status) records = records.filter(r => r.Status === req.query.status);

    // Sort terbaru dulu
    records.sort((a, b) => (b.Tanggal_Canvasing || '').localeCompare(a.Tanggal_Canvasing || ''));

    res.json({ success: true, data: records });
  } catch (e) {
    console.error('[Canvasing/list]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /canvasing ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { id: agentId, nama: agentNama } = req.user;
    const {
      Tanggal_Canvasing, Alamat, Maps_URL,
      Nama_Pemilik, No_WA_Pemilik, Tipe_Properti, Estimasi_Harga,
      Hasil, Catatan, Tanggal_FU,
    } = req.body;

    if (!Alamat) return res.status(400).json({ success: false, message: 'Alamat wajib diisi' });

    const now = new Date().toISOString();
    const newRow = [
      uuidv4(),
      Tanggal_Canvasing || now.slice(0, 10),
      agentId,
      agentNama || '',
      Alamat,
      Maps_URL       || '',
      Nama_Pemilik   || '',
      No_WA_Pemilik  || '',
      Tipe_Properti  || '',
      Estimasi_Harga || '',
      Hasil          || 'Follow Up',
      Catatan        || '',
      Tanggal_FU     || '',
      'Aktif',
      '',   // Listing_ID
      now,
      now,
    ];

    await sheetsService.appendRow(SHEETS.CANVASING, newRow);
    res.status(201).json({ success: true, data: rowToObj(newRow) });
  } catch (e) {
    console.error('[Canvasing/create]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /canvasing/:id ───────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.CANVASING);
    const [, ...data] = rows;
    const idx = data.findIndex(r => r[0] === req.params.id);
    if (idx < 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    const existing = rowToObj(data[idx]);

    // Akses: hanya pemilik atau admin+
    const { role, id: userId } = req.user;
    if (!['superadmin', 'principal', 'kantor', 'admin'].includes(role) && existing.Agen_ID !== userId) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const updated = [
      existing.ID,
      existing.Tanggal_Canvasing,
      existing.Agen_ID,
      existing.Agen_Nama,
      req.body.Alamat          ?? existing.Alamat,
      req.body.Maps_URL        ?? existing.Maps_URL,
      req.body.Nama_Pemilik    ?? existing.Nama_Pemilik,
      req.body.No_WA_Pemilik   ?? existing.No_WA_Pemilik,
      req.body.Tipe_Properti   ?? existing.Tipe_Properti,
      req.body.Estimasi_Harga  ?? existing.Estimasi_Harga,
      req.body.Hasil           ?? existing.Hasil,
      req.body.Catatan         ?? existing.Catatan,
      req.body.Tanggal_FU      ?? existing.Tanggal_FU,
      req.body.Status          ?? existing.Status,
      req.body.Listing_ID      ?? existing.Listing_ID,
      existing.Created_At,
      new Date().toISOString(),
    ];

    await sheetsService.updateRow(SHEETS.CANVASING, idx + 2, updated);
    res.json({ success: true, data: rowToObj(updated) });
  } catch (e) {
    console.error('[Canvasing/update]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
