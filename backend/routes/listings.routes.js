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

// PATCH update listing
router.patch('/:id', async (req, res) => {
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
