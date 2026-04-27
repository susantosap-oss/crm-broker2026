/**
 * Rental Routes — /api/v1/rental
 * ============================================
 * POST /          — tambah data sewa baru
 * GET  /          — list sewa (agen: milik sendiri; admin+: semua)
 * PATCH /:id      — update status / perpanjang
 * DELETE /:id     — hapus data sewa
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const ADMIN_ROLES = ['admin', 'kantor', 'principal', 'superadmin', 'business_manager'];
const VALID_STATUS = ['aktif', 'selesai', 'diperpanjang', 'dibatalkan'];

router.use(authMiddleware);

function rowToRental(row) {
  return COLUMNS.RENTAL_STATUS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// Hitung tanggal selesai: Tanggal_Mulai + Durasi_Bulan
function hitungTanggalSelesai(tanggalMulai, durasiBuilan) {
  const d = new Date(tanggalMulai);
  d.setMonth(d.getMonth() + parseInt(durasiBuilan));
  return d.toISOString().slice(0, 10);
}

// ── POST / ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { role, id: myId } = req.user;
    const {
      agent_id, nama_penyewa, alamat_sewa,
      tanggal_mulai, durasi_bulan, catatan = '',
    } = req.body;

    if (!nama_penyewa || !alamat_sewa || !tanggal_mulai || !durasi_bulan) {
      return res.status(400).json({ success: false, message: 'Field wajib: nama_penyewa, alamat_sewa, tanggal_mulai, durasi_bulan' });
    }

    // Agen hanya bisa input untuk dirinya sendiri
    const targetAgentId = ADMIN_ROLES.includes(role) && agent_id ? agent_id : myId;
    const tanggalSelesai = hitungTanggalSelesai(tanggal_mulai, durasi_bulan);
    const now = new Date().toISOString();
    const rentalId = uuidv4();

    await sheetsService.appendRow(SHEETS.RENTAL_STATUS, [
      rentalId,
      targetAgentId,
      nama_penyewa,
      alamat_sewa,
      tanggal_mulai,
      durasi_bulan,
      tanggalSelesai,
      'aktif',
      'FALSE',
      'FALSE',
      catatan,
      now,
      now,
    ]);

    return res.json({
      success: true,
      data: {
        ID: rentalId, Agen_ID: targetAgentId, Nama_Penyewa: nama_penyewa,
        Alamat_Sewa: alamat_sewa, Tanggal_Mulai: tanggal_mulai,
        Durasi_Bulan: durasi_bulan, Tanggal_Selesai: tanggalSelesai,
        Status: 'aktif',
      },
    });
  } catch (err) {
    console.error('[RENTAL] create error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET / ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { role, id: myId } = req.user;
    const { agent_id, status } = req.query;

    const rows = await sheetsService.getRange(SHEETS.RENTAL_STATUS);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    let data = rows.slice(1).map(rowToRental).filter(r => r.ID);

    const isAdmin = ADMIN_ROLES.includes(role);
    if (isAdmin && agent_id) {
      data = data.filter(r => r.Agen_ID === agent_id);
    } else if (!isAdmin) {
      data = data.filter(r => r.Agen_ID === myId);
    }

    if (status) data = data.filter(r => r.Status === status);

    // Hitung sisa hari untuk tiap baris
    const today = new Date();
    data = data.map(r => {
      const end = new Date(r.Tanggal_Selesai);
      const sisaHari = Math.round((end - today) / (1000 * 60 * 60 * 24));
      return { ...r, Sisa_Hari: sisaHari };
    });

    // Sort: aktif dulu, lalu berdasarkan sisa hari terkecil
    data.sort((a, b) => {
      if (a.Status === 'aktif' && b.Status !== 'aktif') return -1;
      if (a.Status !== 'aktif' && b.Status === 'aktif') return 1;
      return a.Sisa_Hari - b.Sisa_Hari;
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[RENTAL] list error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /:id ────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, id: myId } = req.user;
    const { status, catatan, perpanjang_bulan } = req.body;

    const rows = await sheetsService.getRange(SHEETS.RENTAL_STATUS);
    if (!rows || rows.length < 2) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    const rental = rowToRental(rows[rowIdx]);

    // Agen hanya boleh edit miliknya
    if (!ADMIN_ROLES.includes(role) && rental.Agen_ID !== myId) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const updated = { ...rental };
    if (status && VALID_STATUS.includes(status)) updated.Status = status;
    if (catatan !== undefined) updated.Catatan = catatan;

    // Perpanjang: tambah durasi dan recalc tanggal selesai
    if (perpanjang_bulan && parseInt(perpanjang_bulan) > 0) {
      const newDurasi = parseInt(updated.Durasi_Bulan) + parseInt(perpanjang_bulan);
      updated.Durasi_Bulan = newDurasi;
      updated.Tanggal_Selesai = hitungTanggalSelesai(updated.Tanggal_Mulai, newDurasi);
      updated.Status = 'diperpanjang';
      updated.Reminder_90_Sent = 'FALSE';
      updated.Reminder_30_Sent = 'FALSE';
    }

    updated.Updated_At = new Date().toISOString();

    const newRow = COLUMNS.RENTAL_STATUS.map(c => updated[c] || '');
    await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rowIdx, newRow);

    const sisaHari = Math.round((new Date(updated.Tanggal_Selesai) - new Date()) / (1000 * 60 * 60 * 24));
    return res.json({ success: true, data: { ...updated, Sisa_Hari: sisaHari } });
  } catch (err) {
    console.error('[RENTAL] update error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────
router.delete('/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await sheetsService.getRange(SHEETS.RENTAL_STATUS);
    if (!rows || rows.length < 2) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rowIdx, Array(COLUMNS.RENTAL_STATUS.length).fill(''));

    return res.json({ success: true, message: 'Data sewa berhasil dihapus' });
  } catch (err) {
    console.error('[RENTAL] delete error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
