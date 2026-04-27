/**
 * Legal Routes — /api/v1/legal
 * ============================================
 * POST /upload    — upload PDF ke Drive + simpan metadata ke LEGAL_DOCS
 * GET  /docs      — list dokumen (agen: milik sendiri; admin+: semua / filter by agent_id)
 * DELETE /docs/:id — hapus dokumen dari Drive + Sheets (admin+)
 *
 * Filename auto-generated: {Kategori}_{NamaKlien}_{AlamatUnit}_{YYYYMMDD}.pdf
 */

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const sheetsService = require('../services/sheets.service');
const gdriveService = require('../services/gdrive.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const ADMIN_ROLES = ['admin', 'kantor', 'principal', 'superadmin', 'business_manager'];

// Multer: simpan di memory (max 10 MB, hanya PDF)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Hanya file PDF yang diizinkan'));
  },
});

router.use(authMiddleware);

function rowToDoc(row) {
  return COLUMNS.LEGAL_DOCS.reduce((o, c, i) => { o[c] = row[i] || ''; return o; }, {});
}

// Bersihkan string untuk nama file: hanya alfanumerik + spasi → ganti spasi dengan _
function sanitizeForFilename(str) {
  return (str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // hapus aksen
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 40); // max 40 karakter per segment
}

function generateFilename(kategori, namaKlien, alamatUnit) {
  const now = new Date();
  const tanggal = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const kat  = sanitizeForFilename(kategori);
  const klien = sanitizeForFilename(namaKlien);
  const alamat = sanitizeForFilename(alamatUnit);
  return `${kat}_${klien}_${alamat}_${tanggal}.pdf`;
}

// ── POST /upload ──────────────────────────────────────────────
router.post('/upload', requireRole(...ADMIN_ROLES), upload.single('file'), async (req, res) => {
  try {
    const {
      agent_id,
      kategori    = 'Lainnya',
      nama_klien,
      nama_pemilik = '',
      alamat_unit,
      catatan     = '',
    } = req.body;

    if (!req.file)   return res.status(400).json({ success: false, message: 'File PDF wajib diupload' });
    if (!agent_id)   return res.status(400).json({ success: false, message: 'agent_id wajib diisi' });
    if (!nama_klien) return res.status(400).json({ success: false, message: 'Nama klien wajib diisi' });
    if (!alamat_unit) return res.status(400).json({ success: false, message: 'Alamat unit / nama proyek wajib diisi' });

    const validKategori = ['PJB', 'Sewa', 'SPR', 'Lainnya'];
    const kat = validKategori.includes(kategori) ? kategori : 'Lainnya';

    const generatedFilename = generateFilename(kat, nama_klien, alamat_unit);

    const { fileId, webViewLink, ukuranKB } = await gdriveService.uploadPDF(
      req.file.buffer,
      generatedFilename,
      agent_id,
      kat,
    );

    const now = new Date().toISOString();
    const docId = uuidv4();

    await sheetsService.appendRow(SHEETS.LEGAL_DOCS, [
      docId,
      agent_id,
      generatedFilename,
      kat,
      fileId,
      webViewLink,
      ukuranKB,
      req.user.id,
      now,
      catatan,
      nama_klien,
      nama_pemilik,
      alamat_unit,
    ]);

    return res.json({
      success: true,
      data: {
        ID: docId, Agen_ID: agent_id, Nama_File: generatedFilename,
        Kategori: kat, Drive_URL: webViewLink, Ukuran_KB: ukuranKB,
        Created_At: now, Nama_Klien: nama_klien, Nama_Pemilik: nama_pemilik,
        Alamat_Unit: alamat_unit,
      },
    });
  } catch (err) {
    console.error('[LEGAL] upload error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /docs ─────────────────────────────────────────────────
router.get('/docs', async (req, res) => {
  try {
    const { role, id: myId } = req.user;
    const { agent_id } = req.query;

    const rows = await sheetsService.getRange(SHEETS.LEGAL_DOCS);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    let docs = rows.slice(1).map(rowToDoc).filter(d => d.ID);

    const isAdmin = ADMIN_ROLES.includes((role || '').toLowerCase());
    if (isAdmin && agent_id) {
      docs = docs.filter(d => d.Agen_ID === agent_id);
    } else if (!isAdmin) {
      docs = docs.filter(d => d.Agen_ID === myId);
    }

    return res.json({ success: true, data: docs });
  } catch (err) {
    console.error('[LEGAL] list error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /docs/:id ──────────────────────────────────────────
router.delete('/docs/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await sheetsService.getRange(SHEETS.LEGAL_DOCS);
    if (!rows || rows.length < 2) return res.status(404).json({ success: false, message: 'Dokumen tidak ditemukan' });

    const rowIdx = rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (rowIdx === -1) return res.status(404).json({ success: false, message: 'Dokumen tidak ditemukan' });

    const doc = rowToDoc(rows[rowIdx]);

    if (doc.Drive_File_ID) {
      try { await gdriveService.deleteFile(doc.Drive_File_ID); } catch (e) {
        console.warn('[LEGAL] gagal hapus dari Drive:', e.message);
      }
    }

    await sheetsService.updateRow(SHEETS.LEGAL_DOCS, rowIdx, Array(COLUMNS.LEGAL_DOCS.length).fill(''));

    return res.json({ success: true, message: 'Dokumen berhasil dihapus' });
  } catch (err) {
    console.error('[LEGAL] delete error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
