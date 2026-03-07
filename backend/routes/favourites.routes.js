/**
 * Favourites Routes
 * Base: /api/v1/favourites
 * Simpan fav per-agen di Google Sheets → sync lintas device
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

router.use(authMiddleware);

// Auto-init sheet header kalau belum ada
async function ensureSheet() {
  try {
    const rows = await sheetsService.getRange(SHEETS.FAVOURITES);
    if (!rows || rows.length === 0) {
      await sheetsService.appendRow(SHEETS.FAVOURITES, COLUMNS.FAVOURITES);
    }
  } catch (_) {}
}

const rowToFav = (row) => COLUMNS.FAVOURITES.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});

// GET /favourites — ambil semua listing_id yg difav agen ini
router.get('/', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.FAVOURITES);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });
    const [, ...data] = rows;
    const favs = data
      .map(rowToFav)
      .filter(f => f.Agen_ID === req.user.id && f.Listing_ID);
    res.json({ success: true, data: favs.map(f => f.Listing_ID) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /favourites/:listingId — toggle fav
router.post('/:listingId', async (req, res) => {
  try {
    await ensureSheet();
    const rows = await sheetsService.getRange(SHEETS.FAVOURITES);
    const data = rows.length > 1 ? rows.slice(1) : [];
    const favs = data.map(rowToFav);

    const existing = favs.find(f => f.Agen_ID === req.user.id && f.Listing_ID === req.params.listingId);

    if (existing) {
      // Hapus — cari rowIndex
      const rowIndex = data.findIndex(r => r[0] === existing.ID) + 2; // +2: header + 1-based
      await sheetsService.deleteRow(SHEETS.FAVOURITES, rowIndex);
      res.json({ success: true, action: 'removed' });
    } else {
      // Tambah
      const now = new Date().toISOString();
      await sheetsService.appendRow(SHEETS.FAVOURITES, [
        uuidv4(), req.user.id, req.params.listingId, now
      ]);
      res.json({ success: true, action: 'added' });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
