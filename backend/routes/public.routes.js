/**
 * PUBLIC API ROUTES
 * ============================================
 * Read-only API endpoint untuk website eksternal.
 * Hanya data dengan Tampilkan_di_Web = TRUE yang tampil.
 *
 * Base URL: /public/api/v1
 * Auth: x-api-key header atau ?api_key= query param
 *
 * Endpoints:
 *   GET /listings          → Semua listing publik
 *   GET /listings/:id      → Detail listing publik
 *   GET /listings/featured → Listing unggulan
 *   GET /stats             → Statistik publik
 */

const express = require('express');
const router = express.Router();
const { publicApiKey } = require('../middleware/auth.middleware');
const listingsService = require('../services/listings.service');
const sheetsService = require('../services/sheets.service');

// Apply API key to all public routes
router.use(publicApiKey);

// ── GET /listings ─────────────────────────────────────────
router.get('/listings', async (req, res) => {
  try {
    const { tipe, status_transaksi, kota, harga_min, harga_max, page = 1, limit = 12 } = req.query;

    let listings = await listingsService.getAll({ tampilkan_di_web: true });

    // Additional filters
    if (tipe) listings = listings.filter(l => l.Tipe_Properti === tipe);
    if (status_transaksi) listings = listings.filter(l => l.Status_Transaksi === status_transaksi);
    if (kota) listings = listings.filter(l => l.Kota?.toLowerCase().includes(kota.toLowerCase()));
    if (harga_min) listings = listings.filter(l => parseInt(l.Harga) >= parseInt(harga_min));
    if (harga_max) listings = listings.filter(l => parseInt(l.Harga) <= parseInt(harga_max));

    // Strip internal fields before returning
    const publicListings = listings.map(l => ({
      id: l.ID,
      kode: l.Kode_Listing,
      tipe: l.Tipe_Properti,
      status_transaksi: l.Status_Transaksi,
      status: l.Status_Listing,
      judul: l.Judul,
      deskripsi: l.Deskripsi,
      harga: l.Harga,
      harga_format: l.Harga_Format,
      alamat: l.Alamat,
      kecamatan: l.Kecamatan,
      kota: l.Kota,
      luas_tanah: l.Luas_Tanah,
      luas_bangunan: l.Luas_Bangunan,
      kamar_tidur: l.Kamar_Tidur,
      kamar_mandi: l.Kamar_Mandi,
      garasi: l.Garasi,
      sertifikat: l.Sertifikat,
      foto_utama: l.Foto_Utama_URL,
      foto_gallery: l.Foto_Gallery ? JSON.parse(l.Foto_Gallery) : [],
      featured: l.Featured === 'TRUE',
      koordinat: { lat: l.Koordinat_Lat, lng: l.Koordinat_Lng },
      maps_url: l.Maps_URL,
      updated_at: l.Updated_At,
      // NOTE: Agen_ID, Caption_Sosmed, internal notes NOT exposed
    }));

    // Pagination
    const startIndex = (page - 1) * limit;
    const paginated = publicListings.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: paginated,
      pagination: {
        total: publicListings.length,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(publicListings.length / limit),
      },
      meta: {
        source: 'CRM Broker Properti - GAS Edition',
        timestamp: new Date().toISOString(),
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── GET /listings/featured ────────────────────────────────
router.get('/listings/featured', async (req, res) => {
  try {
    const listings = await listingsService.getAll({ tampilkan_di_web: true, featured: true });
    res.json({ success: true, data: listings.slice(0, 6) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── GET /listings/:id ─────────────────────────────────────
router.get('/listings/:id', async (req, res) => {
  try {
    const listing = await listingsService.getById(req.params.id);

    if (!listing || listing.Tampilkan_di_Web !== 'TRUE') {
      return res.status(404).json({ success: false, message: 'Listing tidak ditemukan' });
    }

    // Increment view count (non-blocking)
    listingsService.incrementView(req.params.id).catch(() => {});

    // Strip all internal/sensitive fields before returning
    const publicListing = {
      id: listing.ID,
      kode: listing.Kode_Listing,
      tipe: listing.Tipe_Properti,
      status_transaksi: listing.Status_Transaksi,
      status: listing.Status_Listing,
      judul: listing.Judul,
      deskripsi: listing.Deskripsi,
      harga: listing.Harga,
      harga_format: listing.Harga_Format,
      alamat: listing.Alamat,
      kecamatan: listing.Kecamatan,
      kota: listing.Kota,
      provinsi: listing.Provinsi,
      luas_tanah: listing.Luas_Tanah,
      luas_bangunan: listing.Luas_Bangunan,
      kamar_tidur: listing.Kamar_Tidur,
      kamar_mandi: listing.Kamar_Mandi,
      lantai: listing.Lantai,
      garasi: listing.Garasi,
      sertifikat: listing.Sertifikat,
      kondisi: listing.Kondisi,
      fasilitas: listing.Fasilitas ? JSON.parse(listing.Fasilitas) : [],
      foto_utama: listing.Foto_Utama_URL,
      foto_gallery: listing.Foto_Gallery ? (() => { try { return JSON.parse(listing.Foto_Gallery); } catch { return []; } })() : [],
      featured: listing.Featured === 'TRUE',
      koordinat: { lat: listing.Koordinat_Lat, lng: listing.Koordinat_Lng },
      maps_url: listing.Maps_URL,
      views: listing.Views_Count,
      updated_at: listing.Updated_At,
      // ⚠️ Fields intentionally NOT exposed: Agen_ID, Caption_Sosmed, Cloudinary_IDs, Notes
    };

    res.json({ success: true, data: publicListing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── GET /stats ────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await sheetsService.getSheetStats();
    res.json({
      success: true,
      data: {
        total_listings_public: stats.totalListings,
        // NOTE: Leads & agents NOT exposed to public
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
