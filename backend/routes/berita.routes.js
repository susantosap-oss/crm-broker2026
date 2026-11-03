/**
 * Berita / News Routes
 * ====================
 * GET  /api/v1/berita       → list semua berita Publish (semua role)
 * GET  /api/v1/berita/:idx  → detail by row index (semua role)
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

function rowToObj(row) {
  const obj = {};
  COLUMNS.NEWS.forEach((c, i) => { obj[c] = row[i] || ''; });
  return obj;
}

// GET / — semua berita (baris dengan Judul tidak kosong)
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRows(SHEETS.NEWS);
    const data = (rows || [])
      .map((r, i) => ({ ...rowToObj(r), _rowIndex: i + 2 }))
      .filter(n => n.Judul);
    res.json({ success: true, data, total: data.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /:idx — detail berita by row index (1-based dari GSheet, header = row 1)
router.get('/:idx', async (req, res) => {
  const idx = parseInt(req.params.idx);
  if (!idx || idx < 2) return res.status(400).json({ success: false, message: 'Index tidak valid' });
  try {
    const rows = await sheetsService.getRows(SHEETS.NEWS);
    const row  = (rows || [])[idx - 2]; // rows dari getRows skip header row 1
    if (!row) return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
    res.json({ success: true, data: rowToObj(row) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
