/**
 * Email Targets Routes — /api/v1/email-targets
 * =============================================
 * CRUD + bulk import + CSV export untuk database prospek email
 * yang dipakai saat kirim Surat Penawaran dari listing/aset.
 */
const express       = require('express');
const router        = express.Router();
const { v4: uuidv4 } = require('uuid');
const sheetsService = require('../services/sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { authMiddleware }  = require('../middleware/auth.middleware');

router.use(authMiddleware);

const toObj = r => COLUMNS.EMAIL_TARGETS.reduce((o, c, i) => { o[c] = r[i] || ''; return o; }, {});

// ── GET /email-targets ────────────────────────────────────────
// Query: ?kategori=Hotel  → filter by kategori
router.get('/', async (req, res) => {
  try {
    const { kategori } = req.query;
    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    if (!rows || rows.length <= 1) return res.json({ data: [] });

    let targets = rows.slice(1).map(toObj).filter(t => t.ID);

    if (kategori) targets = targets.filter(t => t.Kategori === kategori);

    targets.sort((a, b) => new Date(b.Created_At || 0) - new Date(a.Created_At || 0));
    res.json({ data: targets });
  } catch (e) {
    console.error('[EmailTargets] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /email-targets ───────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { Email, Nama_Kontak, Kategori, Kota, Catatan } = req.body;
    if (!Email) return res.status(400).json({ error: 'Email wajib diisi' });

    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    const existing = (rows || []).slice(1).map(toObj);
    if (existing.find(t => t.Email.toLowerCase() === Email.toLowerCase())) {
      return res.status(409).json({ error: 'Email sudah ada di database' });
    }

    const now = new Date().toISOString();
    const id  = uuidv4();
    const row = COLUMNS.EMAIL_TARGETS.map(c => ({
      ID: id, Email, Nama_Kontak: Nama_Kontak || '', Kategori: Kategori || 'Lainnya',
      Kota: Kota || '', Catatan: Catatan || '',
      Ditambah_Oleh: req.user.id, Created_At: now,
    }[c] ?? ''));

    await sheetsService.appendRow(SHEETS.EMAIL_TARGETS, row);
    res.json({ success: true, data: { ID: id, Email, Nama_Kontak, Kategori, Kota, Catatan, Created_At: now } });
  } catch (e) {
    console.error('[EmailTargets] POST error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /email-targets/bulk — import dari CSV ────────────────
router.post('/bulk', async (req, res) => {
  try {
    const { items } = req.body; // array of { Email, Nama_Kontak, Kategori, Kota, Catatan }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items harus array tidak kosong' });
    }

    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    const existingEmails = new Set(
      (rows || []).slice(1).map(toObj).filter(t => t.ID).map(t => t.Email.toLowerCase())
    );

    const now = new Date().toISOString();
    let added = 0; let skipped = 0;

    for (const item of items) {
      if (!item.Email) { skipped++; continue; }
      if (existingEmails.has(item.Email.toLowerCase())) { skipped++; continue; }

      const id  = uuidv4();
      const row = COLUMNS.EMAIL_TARGETS.map(c => ({
        ID: id, Email: item.Email,
        Nama_Kontak: item.Nama_Kontak || '', Kategori: item.Kategori || 'Lainnya',
        Kota: item.Kota || '', Catatan: item.Catatan || '',
        Ditambah_Oleh: req.user.id, Created_At: now,
      }[c] ?? ''));

      await sheetsService.appendRow(SHEETS.EMAIL_TARGETS, row);
      existingEmails.add(item.Email.toLowerCase());
      added++;
    }

    res.json({ success: true, added, skipped });
  } catch (e) {
    console.error('[EmailTargets] BULK error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /email-targets/export — download CSV ─────────────────
router.get('/export', async (req, res) => {
  try {
    const { kategori } = req.query;
    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    let targets = (rows || []).slice(1).map(toObj).filter(t => t.ID);
    if (kategori) targets = targets.filter(t => t.Kategori === kategori);

    const header = 'Email,Nama_Kontak,Kategori,Kota,Catatan\n';
    const csvRows = targets.map(t =>
      [t.Email, t.Nama_Kontak, t.Kategori, t.Kota, t.Catatan]
        .map(v => `"${(v || '').replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');

    const filename = kategori ? `email-target-${kategori}.csv` : 'email-targets-all.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + header + csvRows); // BOM untuk Excel agar baca UTF-8 dengan benar
  } catch (e) {
    console.error('[EmailTargets] EXPORT error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /email-targets/:id ─────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    if (!rows) return res.status(404).json({ error: 'Tidak ditemukan' });

    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Email target tidak ditemukan' });

    await sheetsService.updateRow(SHEETS.EMAIL_TARGETS, rowIdx + 1,
      new Array(COLUMNS.EMAIL_TARGETS.length).fill(''));
    res.json({ success: true });
  } catch (e) {
    console.error('[EmailTargets] DELETE error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /email-targets/:id ──────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await sheetsService.getRange(SHEETS.EMAIL_TARGETS);
    if (!rows) return res.status(404).json({ error: 'Tidak ditemukan' });

    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Email target tidak ditemukan' });

    const current = toObj(rows[rowIdx]);
    const updated = { ...current, ...req.body };
    const row = COLUMNS.EMAIL_TARGETS.map(c => updated[c] ?? '');

    await sheetsService.updateRow(SHEETS.EMAIL_TARGETS, rowIdx + 1, row);
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[EmailTargets] PATCH error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
