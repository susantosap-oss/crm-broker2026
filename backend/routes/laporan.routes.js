/**
 * Laporan Routes — /api/v1/laporan
 * ============================================
 * Admin menulis laporan harian
 * Principal & Superadmin bisa review semua laporan
 */
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireMinRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

function rowToLaporan(row) {
  return COLUMNS.LAPORAN_HARIAN.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// GET /laporan — list laporan
router.get('/', requireMinRole('admin'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.LAPORAN_HARIAN);
    if (rows.length < 2) return res.json({ success: true, data: [] });
    let data = rows.slice(1).map(rowToLaporan).filter(l => l.ID);

    const { role, id } = req.user;
    // Admin hanya lihat milik sendiri
    if (role === 'admin') data = data.filter(l => l.Admin_ID === id);

    data.sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
    if (req.query.limit) data = data.slice(0, parseInt(req.query.limit));
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /laporan/today — laporan hari ini milik admin
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().substring(0, 10);
    const rows = await sheetsService.getRange(SHEETS.LAPORAN_HARIAN);
    if (rows.length < 2) return res.json({ success: true, data: null });
    const data = rows.slice(1).map(rowToLaporan).filter(l => l.ID);
    const todayReport = data.find(l => l.Admin_ID === req.user.id && l.Tanggal === today);
    res.json({ success: true, data: todayReport || null });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /laporan/summary — untuk dashboard principal/superadmin
router.get('/summary', requireMinRole('principal'), async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.LAPORAN_HARIAN);
    if (rows.length < 2) return res.json({ success: true, data: [] });
    const data = rows.slice(1).map(rowToLaporan).filter(l => l.ID);
    // 7 hari terakhir
    const since = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
    const recent = data.filter(l => l.Tanggal >= since).sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
    res.json({ success: true, data: recent });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /laporan — simpan laporan baru
router.post('/', async (req, res) => {
  try {
    const { Isi_Laporan } = req.body;
    if (!Isi_Laporan?.trim()) return res.status(400).json({ success: false, message: 'Isi laporan tidak boleh kosong' });

    const today = new Date().toISOString().substring(0, 10);
    const now   = new Date().toISOString();

    // Cek apakah sudah ada laporan hari ini
    const rows = await sheetsService.getRange(SHEETS.LAPORAN_HARIAN);
    if (rows.length > 1) {
      const data = rows.slice(1).map(rowToLaporan);
      const existing = data.findIndex(l => l.Admin_ID === req.user.id && l.Tanggal === today);
      if (existing >= 0) {
        // Update existing
        const row = data[existing];
        row.Isi_Laporan = Isi_Laporan.trim();
        row.Updated_At  = now;
        await sheetsService.updateRow(SHEETS.LAPORAN_HARIAN, existing + 2, COLUMNS.LAPORAN_HARIAN.map(c => row[c] || ''));
        return res.json({ success: true, message: 'Laporan hari ini diupdate', data: { id: row.ID } });
      }
    }

    // Buat baru
    const id = uuidv4();
    const row = COLUMNS.LAPORAN_HARIAN.map(col => {
      if (col === 'ID')          return id;
      if (col === 'Tanggal')     return today;
      if (col === 'Admin_ID')    return req.user.id;
      if (col === 'Admin_Nama')  return req.user.nama;
      if (col === 'Isi_Laporan') return Isi_Laporan.trim();
      if (col === 'Created_At')  return now;
      if (col === 'Updated_At')  return now;
      return '';
    });
    await sheetsService.appendRow(SHEETS.LAPORAN_HARIAN, row);
    res.status(201).json({ success: true, message: 'Laporan berhasil disimpan', data: { id } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
