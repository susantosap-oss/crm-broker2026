/**
 * Listings Routes (Internal CRM)
 * Base: /api/v1/listings
 * ============================================
 * - Multi foto: Foto_Utama + Foto_2 + Foto_3
 * - Tambah foto untuk listing yang sudah ada
 * - Role-based: agen hanya listing sendiri, BM/Principal lihat tim
 */

const express = require('express');
const router  = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const listingsService = require('../services/listings.service');
const captionService  = require('../services/caption.service');
const cloudinaryService = require('../services/cloudinary.service');
const multer = require('multer');

const upload = multer({ dest: '/tmp/uploads/' });

router.use(authMiddleware);

// GET all listings
router.get('/', async (req, res) => {
  try {
    const filters = { ...req.query };
    const { role, id, team_id } = req.user;

    if (req.query.all !== '1') {
      // Tab "Listing Saya" — semua role filter by agen sendiri
      filters.agen_id = id;
    } else {
      // Tab "Semua Kantor" — filter berdasarkan scope role
      if (role === 'business_manager' && team_id) {
        filters.team_id = team_id;
      } else if (role === 'principal') {
        filters.principal_id = id;
      }
      // superadmin & admin → lihat semua, tidak ada filter tambahan
    }

    const listings = await listingsService.getAll(filters);
    res.json({ success: true, data: listings, count: listings.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET listings tanpa foto (untuk fitur tambah foto)
router.get('/no-photo', async (req, res) => {
  try {
    const filters = { agen_id: req.user.role === 'agen' ? req.user.id : undefined };
    const listings = await listingsService.getAll(filters);
    const noPhoto = listings.filter(l => !l.Foto_Utama_URL);
    res.json({ success: true, data: noPhoto, count: noPhoto.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET single listing
// GET /listings/pdf?ids=id1,id2,... — generate PDF properti favorit
router.get('/pdf', async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ success: false, message: 'ids diperlukan' });

    const idList = ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

    // Pakai listingsService yang sudah ter-import
    const allListings = await listingsService.getAll();
    const listings = idList.map(id => allListings.find(l => l.ID === id)).filter(Boolean);
    if (!listings.length) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

    const PDFDocument = require('pdfkit');
    const axios        = require('axios');

    // ── sanitize(): strip karakter non-Latin1 untuk PDFKit Helvetica ──────────
    // PDFKit built-in fonts hanya support Windows-1252 (Latin-1 extended).
    // Karakter seperti ² (U+00B2) tampil sebagai "Ð" jika tidak di-sanitize.
    const sanitize = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/\u00B2/g, '2').replace(/\u00B3/g, '3').replace(/\u00B9/g, '1')
        .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2192\u2190\u2194]/g, '->').replace(/\u2022/g, '*')
        .replace(/\\\\n/g, '\\n').replace(/\\\\r/g, '')
        .replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n')
        .replace(/[^\x00-\xFF]/g, '')
        .trim();
    };

    // Helper: download image buffer dari URL
    const fetchImage = async (url) => {
      if (!url) return null;
      try {
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(r.data);
      } catch (_) { return null; }
    };
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="mansion-listing-${Date.now()}.pdf"`);
    doc.pipe(res);

    const formatRp = (n) => {
      const num = parseInt(n) || 0;
      if (num >= 1e9) return `Rp ${(num/1e9).toFixed(1).replace('.0','')} M`;
      if (num >= 1e6) return `Rp ${(num/1e6).toFixed(0)} Jt`;
      return `Rp ${num.toLocaleString('id-ID')}`;
    };

    const NAVY  = '#0D1526';
    const GOLD  = '#C9972A';
    const GRAY  = '#555555';
    const LIGHT = '#F5F5F5';

    for (let idx = 0; idx < listings.length; idx++) {
      const l = listings[idx];
      if (idx > 0) doc.addPage();

      // ── Header bar ──
      doc.rect(0, 0, 595, 56).fill(NAVY);
      doc.fontSize(18).fillColor(GOLD).font('Helvetica-Bold')
         .text('MANSION PROPERTI', 40, 16);
      doc.fontSize(9).fillColor('white').font('Helvetica')
         .text('Properti Listing', 40, 38);
      doc.fontSize(9).fillColor(GOLD)
         .text(`${idx+1} / ${listings.length}`, 500, 24, { align: 'right', width: 55 });

      let y = 76;

      // ── Judul & badge ──
      doc.fontSize(16).fillColor(NAVY).font('Helvetica-Bold')
         .text(l.Judul || 'Listing Properti', 40, y, { width: 515 });
      y = doc.y + 6;

      // Badges
      const badges = [l.Tipe_Properti, l.Status_Transaksi, l.Status_Listing].filter(Boolean);
      let bx = 40;
      badges.forEach(b => {
        const w = b.length * 7 + 14;
        doc.roundedRect(bx, y, w, 18, 4).fill(GOLD);
        doc.fontSize(8).fillColor('white').font('Helvetica-Bold').text(b, bx + 7, y + 5);
        bx += w + 8;
      });
      y += 30;

      // ── Thumbnail foto ──
      const imgBuf = await fetchImage(l.Foto_Utama_URL);
      if (imgBuf) {
        try {
          doc.image(imgBuf, 40, y, { width: 200, height: 140, fit: [200, 140], align: 'center', valign: 'center' });
          // Info di sebelah kanan foto
          const rx = 260;
          if (l.Kode_Listing) {
            doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(`Kode: ${l.Kode_Listing}`, rx, y);
          }
          doc.fontSize(22).fillColor(GOLD).font('Helvetica-Bold')
             .text(l.Harga_Format || formatRp(l.Harga), rx, y + 16, { width: 295 });
          const lokasi = [l.Kecamatan, l.Kota].filter(Boolean).join(', ') || '—';
          doc.fontSize(10).fillColor(GRAY).font('Helvetica')
             .text(lokasi, rx, y + 50, { width: 295 });
          y += 150;
        } catch (_) {
          // fallback: tampil kode & harga tanpa foto
          if (l.Kode_Listing) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(`Kode: ${l.Kode_Listing}`, 40, y); y += 14; }
          doc.fontSize(22).fillColor(GOLD).font('Helvetica-Bold').text(l.Harga_Format || formatRp(l.Harga), 40, y);
          y = doc.y + 10;
        }
      } else {
        // Tidak ada foto — tampil kode & harga
        if (l.Kode_Listing) { doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(`Kode: ${l.Kode_Listing}`, 40, y); y += 14; }
        doc.fontSize(22).fillColor(GOLD).font('Helvetica-Bold').text(l.Harga_Format || formatRp(l.Harga), 40, y);
        y = doc.y + 10;
      }
      // ── Divider ──
      doc.moveTo(40, y).lineTo(555, y).strokeColor(GOLD).lineWidth(1).stroke();
      y += 14;

      // ── Info grid 2 kolom ──
      const col1 = 40, col2 = 300, colW = 240;
      const fields = [
        ['Lokasi',    [l.Kecamatan, l.Kota].filter(Boolean).join(', ') || '—'],
        ['Luas Tanah',    l.Luas_Tanah    ? `${l.Luas_Tanah} m2`    : 'N/A'],
        ['Luas Bangunan', l.Luas_Bangunan ? `${l.Luas_Bangunan} m2` : 'N/A'],
        ['Kamar Tidur',   l.Kamar_Tidur   ? `${l.Kamar_Tidur} KT`   : 'N/A'],
        ['Kamar Mandi',   l.Kamar_Mandi   ? `${l.Kamar_Mandi} KM`   : 'N/A'],
        ['Sertifikat',    sanitize(l.Sertifikat) || 'N/A'],
      ];

      fields.forEach(([label, val], i) => {
        const cx = i % 2 === 0 ? col1 : col2;
        if (i % 2 === 0 && i > 0) y += 28;
        doc.fontSize(8).fillColor(GRAY).font('Helvetica').text(label, cx, y);
        doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(val, cx, y + 11, { width: colW });
      });
      y += 38;

      // ── Agen ──
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
      y += 10;
      doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('Agen', 40, y);
      doc.fontSize(10).fillColor(NAVY).font('Helvetica-Bold').text(l.Agen_Nama || '—', 40, y + 11);
      y += 30;

      // ── Deskripsi ──
      if (l.Deskripsi) {
        const desk = sanitize(l.Deskripsi.replace(/#\w+/g, '').trim()).substring(0, 500);
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        y += 10;
        doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('Deskripsi', 40, y);
        y += 12;
        doc.fontSize(10).fillColor(GRAY).font('Helvetica')
           .text(desk, 40, y, { width: 515, lineGap: 3 });
        y = doc.y + 10;
      }

      // ── Footer ──
      doc.rect(0, 800, 595, 42).fill(NAVY);
      doc.fontSize(8).fillColor('#8899BB').font('Helvetica')
         .text('Mansion Properti  ·  Dokumen Internal', 40, 812);
      doc.fontSize(8).fillColor(GOLD)
         .text(new Date().toLocaleDateString('id-ID', {dateStyle:'medium'}), 400, 812, { align:'right', width: 155 });
    }

    doc.end();
  } catch (e) {
    console.error('[PDF ERROR]', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ success: false, message: e.message, stack: e.stack });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const listing = await listingsService.getById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    res.json({ success: true, data: listing });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST create listing (max 3 foto: utama + 2)
router.post('/', upload.array('photos', 3), async (req, res) => {
  try {
    let photoData = {};

    if (req.files?.length > 0) {
      const uploads = await cloudinaryService.uploadMultiple(req.files, Date.now());
      photoData = {
        Foto_Utama_URL: uploads[0]?.secure_url || '',
        Foto_2_URL:     uploads[1]?.secure_url || '',
        Foto_3_URL:     uploads[2]?.secure_url || '',
        Foto_Gallery:   JSON.stringify(uploads.slice(1).map(u => u.secure_url)),
        Cloudinary_IDs: JSON.stringify(uploads.map(u => u.public_id)),
      };
    }

    const listing = await listingsService.create(
      { ...req.body, ...photoData, Team_ID: req.user.team_id || '' },
      req.user
    );

    if (!listing.Caption_Sosmed) {
      try {
        const caption = captionService.generate(listing);
        await listingsService.update(listing.ID, { Caption_Sosmed: caption });
        listing.Caption_Sosmed = caption;
      } catch (_) {}
    }

    res.status(201).json({ success: true, data: listing, message: 'Listing berhasil ditambahkan' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH / PUT update listing
router.patch('/:id', async (req, res) => {
  try {
    const listing = await listingsService.update(req.params.id, req.body);
    res.json({ success: true, data: listing, message: 'Listing berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
router.put('/:id', async (req, res) => {
  try {
    const listing = await listingsService.update(req.params.id, req.body);
    res.json({ success: true, data: listing, message: 'Listing berhasil diupdate' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /:id/add-photos — tambah/ganti foto untuk listing yang sudah ada
router.post('/:id/add-photos', upload.array('photos', 3), async (req, res) => {
  try {
    const listing = await listingsService.getById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });

    // Cek akses
    if (req.user.role === 'agen' && listing.Agen_ID !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'Tidak ada foto yang diupload' });
    }

    const uploads = await cloudinaryService.uploadMultiple(req.files, req.params.id);
    const photoUpdate = {};

    // Assign foto ke slot yang tersedia
    const slots = ['Foto_Utama_URL', 'Foto_2_URL', 'Foto_3_URL'];
    let uploadIdx = 0;

    for (const slot of slots) {
      if (uploadIdx >= uploads.length) break;
      // Isi slot kosong, atau overwrite jika replace=true
      if (!listing[slot] || req.body.replace === 'true') {
        photoUpdate[slot] = uploads[uploadIdx]?.secure_url || '';
        uploadIdx++;
      }
    }

    // Update Cloudinary IDs
    const existingIds = tryParse(listing.Cloudinary_IDs, []);
    const newIds = uploads.map(u => u.public_id);
    photoUpdate.Cloudinary_IDs = JSON.stringify([...existingIds, ...newIds]);
    photoUpdate.Foto_Gallery = JSON.stringify(
      [photoUpdate.Foto_2_URL || listing.Foto_2_URL, photoUpdate.Foto_3_URL || listing.Foto_3_URL].filter(Boolean)
    );

    await listingsService.update(req.params.id, photoUpdate);

    res.json({
      success: true,
      data: photoUpdate,
      message: `${uploads.length} foto berhasil ditambahkan`,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE foto dari listing
router.delete('/:id/photo', async (req, res) => {
  try {
    const { slot } = req.body; // 'Foto_Utama_URL' | 'Foto_2_URL' | 'Foto_3_URL'
    if (!['Foto_Utama_URL', 'Foto_2_URL', 'Foto_3_URL'].includes(slot)) {
      return res.status(400).json({ success: false, message: 'Slot tidak valid' });
    }
    await listingsService.update(req.params.id, { [slot]: '' });
    res.json({ success: true, message: 'Foto dihapus' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH toggle web visibility
router.patch('/:id/web-visibility', async (req, res) => {
  try {
    const { visible } = req.body;
    await listingsService.toggleWebVisibility(req.params.id, visible);
    res.json({ success: true, message: `Listing ${visible ? 'dipublikasikan ke' : 'disembunyikan dari'} website` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET social media asset bundle
router.get('/:id/sosmed-bundle', async (req, res) => {
  try {
    const bundle = await listingsService.getSocialMediaBundle(req.params.id);
    res.json({ success: true, data: bundle });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST generate caption
router.post('/:id/generate-caption', async (req, res) => {
  try {
    const listing = await listingsService.getById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    const { style = 'standard' } = req.body;
    const caption = captionService.generate(listing, style);
    await listingsService.update(req.params.id, { Caption_Sosmed: caption });
    res.json({ success: true, data: { caption, style } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /stats/by-agent — untuk Principal & BM
router.get('/stats/by-agent', async (req, res) => {
  try {
    const { role, id, team_id } = req.user;
    if (!['principal', 'business_manager', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const filters = {};
    if (role === 'business_manager' && team_id) filters.team_id = team_id;
    if (role === 'principal') filters.principal_id = id;

    const listings = await listingsService.getAll(filters);

    // Group by agen
    const byAgent = {};
    listings.forEach(l => {
      const key = l.Agen_ID;
      if (!byAgent[key]) byAgent[key] = { agen_id: key, agen_nama: l.Agen_Nama, total: 0, aktif: 0, items: [] };
      byAgent[key].total++;
      if (l.Status_Listing === 'Aktif') byAgent[key].aktif++;
      byAgent[key].items.push({ id: l.ID, judul: l.Judul, harga: l.Harga_Format || l.Harga, status: l.Status_Listing, foto: l.Foto_Utama_URL });
    });

    res.json({ success: true, data: Object.values(byAgent), total: listings.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

function tryParse(str, fallback) {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}

module.exports = router;
