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
      agen_listing_id = '', agen_listing_nama = '',
      agen_selling_id = '', agen_selling_nama = '',
      cobroke = 'FALSE',
      periode_sewa = 'Tahunan',
      durasi_total_bulan,
    } = req.body;

    if (!nama_penyewa || !alamat_sewa || !tanggal_mulai) {
      return res.status(400).json({ success: false, message: 'Field wajib: nama_penyewa, alamat_sewa, tanggal_mulai' });
    }

    const targetAgentId = ADMIN_ROLES.includes(role) && agent_id ? agent_id : myId;
    const now = new Date().toISOString();

    // ── Bulanan: buat N record, masing-masing 1 bulan, chain via Ref_ID ──
    if (periode_sewa === 'Bulanan') {
      const totalBulan = parseInt(durasi_total_bulan);
      if (!totalBulan || ![3, 6, 12].includes(totalBulan)) {
        return res.status(400).json({ success: false, message: 'durasi_total_bulan wajib: 3, 6, atau 12' });
      }

      let prevId    = '';
      let curStart  = tanggal_mulai;
      let firstData = null;

      for (let i = 1; i <= totalBulan; i++) {
        const periodId  = uuidv4();
        const periodEnd = hitungTanggalSelesai(curStart, 1);
        await sheetsService.appendRow(SHEETS.RENTAL_STATUS, [
          periodId, targetAgentId, nama_penyewa, alamat_sewa,
          curStart, 1, periodEnd,
          'aktif', 'FALSE', 'FALSE', catatan, now, now,
          agen_listing_id, agen_listing_nama,
          agen_selling_id, agen_selling_nama,
          cobroke, '',            // Hasil_FU_Reminder (S)
          prevId,                 // Ref_ID (T)
          'Bulanan', totalBulan, i, 'FALSE',  // U, V, W, X
        ]);
        if (i === 1) firstData = { ID: periodId, Tanggal_Mulai: curStart, Tanggal_Selesai: periodEnd };
        prevId   = periodId;
        curStart = periodEnd;
      }

      return res.json({
        success: true,
        data: {
          ID: firstData.ID, Agen_ID: targetAgentId, Nama_Penyewa: nama_penyewa,
          Alamat_Sewa: alamat_sewa, Tanggal_Mulai: firstData.Tanggal_Mulai,
          Durasi_Bulan: 1, Tanggal_Selesai: firstData.Tanggal_Selesai,
          Status: 'aktif', Periode_Sewa: 'Bulanan', Durasi_Total_Bulan: totalBulan,
        },
      });
    }

    // ── Tahunan (default) ─────────────────────────────────────
    if (!durasi_bulan) {
      return res.status(400).json({ success: false, message: 'durasi_bulan wajib untuk sewa Tahunan' });
    }
    const tanggalSelesai = hitungTanggalSelesai(tanggal_mulai, durasi_bulan);
    const rentalId = uuidv4();

    await sheetsService.appendRow(SHEETS.RENTAL_STATUS, [
      rentalId, targetAgentId, nama_penyewa, alamat_sewa,
      tanggal_mulai, durasi_bulan, tanggalSelesai,
      'aktif', 'FALSE', 'FALSE', catatan, now, now,
      agen_listing_id, agen_listing_nama,
      agen_selling_id, agen_selling_nama,
      cobroke, '',        // Hasil_FU_Reminder (S)
      '',                 // Ref_ID (T)
      'Tahunan', '', '', '',  // U, V, W, X
    ]);

    return res.json({
      success: true,
      data: {
        ID: rentalId, Agen_ID: targetAgentId, Nama_Penyewa: nama_penyewa,
        Alamat_Sewa: alamat_sewa, Tanggal_Mulai: tanggal_mulai,
        Durasi_Bulan: durasi_bulan, Tanggal_Selesai: tanggalSelesai,
        Status: 'aktif', Periode_Sewa: 'Tahunan',
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
    const { status, catatan, perpanjang_bulan, hasil_fu_reminder,
            agen_listing_id, agen_listing_nama,
            agen_selling_id, agen_selling_nama, cobroke } = req.body;

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
    if (catatan !== undefined)         updated.Catatan = catatan;
    if (hasil_fu_reminder !== undefined) updated.Hasil_FU_Reminder = hasil_fu_reminder;
    if (agen_listing_id !== undefined)  updated.Agen_Listing_ID   = agen_listing_id;
    if (agen_listing_nama !== undefined) updated.Agen_Listing_Nama = agen_listing_nama;
    if (agen_selling_id !== undefined)  updated.Agen_Selling_ID   = agen_selling_id;
    if (agen_selling_nama !== undefined) updated.Agen_Selling_Nama = agen_selling_nama;
    if (cobroke !== undefined)          updated.CoBroke            = cobroke;

    // Perpanjang: freeze record lama → buat record baru dengan tanggal baru
    if (perpanjang_bulan && parseInt(perpanjang_bulan) > 0) {
      const now = new Date().toISOString();
      // Freeze old record: status diperpanjang, tanggal TIDAK berubah
      updated.Status = 'diperpanjang';
      updated.Updated_At = now;
      const frozenRow = COLUMNS.RENTAL_STATUS.map(c => updated[c] || '');
      await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rowIdx + 1, frozenRow);

      // Buat record baru: mulai dari Tanggal_Selesai lama
      const newId = uuidv4();
      const newStart = rental.Tanggal_Selesai;
      const newDurasi = parseInt(perpanjang_bulan);
      const newEnd = hitungTanggalSelesai(newStart, newDurasi);
      await sheetsService.appendRow(SHEETS.RENTAL_STATUS, [
        newId, rental.Agen_ID, rental.Nama_Penyewa, rental.Alamat_Sewa,
        newStart, newDurasi, newEnd,
        'aktif', 'FALSE', 'FALSE',
        updated.Catatan || '',
        now, now,
        updated.Agen_Listing_ID || '', updated.Agen_Listing_Nama || '',
        updated.Agen_Selling_ID || '', updated.Agen_Selling_Nama || '',
        updated.CoBroke || 'FALSE',
        '',         // Hasil_FU_Reminder
        rental.ID,  // Ref_ID → link ke record sebelumnya (diperpanjang)
        'Tahunan', '', '', 'FALSE',  // U, V, W, X — perpanjang selalu Tahunan
      ]);

      const sisaHari = Math.round((new Date(newEnd) - new Date()) / (1000 * 60 * 60 * 24));
      return res.json({ success: true, data: {
        ID: newId, Agen_ID: rental.Agen_ID,
        Nama_Penyewa: rental.Nama_Penyewa, Alamat_Sewa: rental.Alamat_Sewa,
        Tanggal_Mulai: newStart, Durasi_Bulan: newDurasi, Tanggal_Selesai: newEnd,
        Status: 'aktif', Ref_ID: rental.ID, Sisa_Hari: sisaHari,
      }});
    }

    updated.Updated_At = new Date().toISOString();

    const newRow = COLUMNS.RENTAL_STATUS.map(c => updated[c] || '');
    await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rowIdx + 1, newRow);

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

    await sheetsService.updateRow(SHEETS.RENTAL_STATUS, rowIdx + 1, Array(COLUMNS.RENTAL_STATUS.length).fill(''));

    return res.json({ success: true, message: 'Data sewa berhasil dihapus' });
  } catch (err) {
    console.error('[RENTAL] delete error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
