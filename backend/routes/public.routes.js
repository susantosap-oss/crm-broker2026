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
const listingsService  = require('../services/listings.service');
const projectsService  = require('../services/projects.service');
const sheetsService    = require('../services/sheets.service');
const searchService    = require('../services/search.service');
const { extractFilter } = require('../services/ai-filter.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// Helper: build foto_gallery from Foto_Gallery JSON or fallback to Foto_2/3_URL
function buildFotoGallery(obj) {
  if (obj.Foto_Gallery) {
    try { return JSON.parse(obj.Foto_Gallery); } catch { /* fall through */ }
  }
  return [obj.Foto_2_URL, obj.Foto_3_URL].filter(Boolean);
}

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
      foto_gallery: buildFotoGallery(l),
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
      foto_gallery: buildFotoGallery(listing),
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

// ── GET /projects ─────────────────────────────────────────
router.get('/projects', async (req, res) => {
  try {
    const { page = 1, limit = 20, tipe, kota, status_transaksi } = req.query;
    const allProjects = await projectsService.getAll();
    let projects = (allProjects || []).filter(p =>
      p.Status_Project === 'Aktif' && p.Tampilkan_di_Web !== 'FALSE'
    );

    if (tipe) projects = projects.filter(p => p.Tipe_Properti === tipe);
    if (kota) projects = projects.filter(p => p.Kota?.toLowerCase().includes(kota.toLowerCase()));
    if (status_transaksi) projects = projects.filter(p => p.Status_Transaksi === status_transaksi);

    const publicProjects = projects.map(p => ({
      id: p.ID,
      kode: p.Kode_Proyek || p.ID,
      nama: p.Nama_Proyek,
      tipe: p.Tipe_Properti,
      status_transaksi: p.Status_Transaksi,
      kota: p.Kota,
      kecamatan: p.Kecamatan,
      harga_mulai: p.Harga_Mulai,
      harga_mulai_format: p.Harga_Mulai_Format,
      deskripsi: p.Deskripsi,
      foto_utama: p.Foto_1_URL,
      foto_gallery: [p.Foto_2_URL, p.Foto_3_URL, p.Foto_4_URL].filter(Boolean),
      updated_at: p.Updated_At,
    }));

    const startIndex = (page - 1) * limit;
    const paginated = publicProjects.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: paginated,
      pagination: {
        total: publicProjects.length,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(publicProjects.length / parseInt(limit)),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /projects/:id ─────────────────────────────────────
router.get('/projects/:id', async (req, res) => {
  try {
    const project = await projectsService.getById(req.params.id);
    if (!project || project.Status_Project !== 'Aktif') {
      return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan' });
    }

    res.json({
      success: true,
      data: {
        id: project.ID,
        kode: project.Kode_Proyek || project.ID,
        nama: project.Nama_Proyek,
        tipe: project.Tipe_Properti,
        status_transaksi: project.Status_Transaksi,
        kota: project.Kota,
        kecamatan: project.Kecamatan,
        harga_mulai: project.Harga_Mulai,
        harga_mulai_format: project.Harga_Mulai_Format,
        deskripsi: project.Deskripsi,
        fasilitas: project.Fasilitas ? (() => { try { return JSON.parse(project.Fasilitas); } catch { return []; } })() : [],
        foto_utama: project.Foto_1_URL,
        foto_gallery: [project.Foto_2_URL, project.Foto_3_URL, project.Foto_4_URL].filter(Boolean),
        koordinat: { lat: project.Koordinat_Lat, lng: project.Koordinat_Lng },
        maps_url: project.Maps_URL,
        updated_at: project.Updated_At,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /search ───────────────────────────────────────────
// Property Search Engine — Public API
// Filters: keyword, property_type, transaction_type, city, area,
//   cluster, developer, price_min, price_max, bedroom_min,
//   bathroom_min, land_area_min, land_area_max,
//   building_area_min, building_area_max, status, featured
// Pagination: page, limit (max 100)
// Sort: terbaru | terlama | harga_termurah | harga_termahal | terpopuler
router.get('/search', async (req, res) => {
  try {
    const result = await searchService.search(req.query, { publicOnly: true });
    res.json({
      success: true,
      ...result,
      meta: {
        source:    'Mansion Property Search Engine v1.0',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[PUBLIC SEARCH GET]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /search ──────────────────────────────────────────
// AI-Ready endpoint: AI layer POST JSON filter ke sini.
// Contoh body: { "property_type": "Rumah", "area": "Citraland",
//   "price_max": 3000000000, "bedroom_min": 3 }
router.post('/search', async (req, res) => {
  try {
    const params = { ...req.query, ...req.body };
    const result = await searchService.search(params, { publicOnly: true });
    res.json({
      success: true,
      ...result,
      meta: {
        source:    'Mansion Property Search Engine v1.0',
        filter:    params,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[PUBLIC SEARCH POST]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /search/options ───────────────────────────────────
// Filter options untuk UI dropdown website publik
router.get('/search/options', async (req, res) => {
  try {
    const options = await searchService.getFilterOptions({ publicOnly: true });
    res.json({ success: true, data: options });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /ai-search ───────────────────────────────────────
// AI Search Layer: natural language → filter → search results
// Body: { query: string, page?: number, limit?: number, sort?: string }
// Rate limit: 20 req/menit per IP (lebih ketat karena hit Groq API)
const aiSearchLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak AI search request, coba lagi dalam 1 menit' },
});

router.post('/ai-search', aiSearchLimiter, async (req, res) => {
  const { query, page = 1, limit = 12, sort = 'terbaru' } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ success: false, message: 'Field "query" wajib diisi' });
  }

  try {
    const { filter, raw_query, ai_extracted, fallback } = await extractFilter(query.trim());

    // Merge AI filter + pagination params
    const searchParams = {
      ...filter,
      page:  Number(page)  || 1,
      limit: Math.min(Number(limit) || 12, 50),
      sort,
    };

    const result = await searchService.search(searchParams, { publicOnly: true });

    res.json({
      success: true,
      ...result,
      ai: {
        raw_query,
        extracted_filter: filter,
        ai_raw:           ai_extracted || null,
        fallback:         fallback || false,
      },
      meta: {
        source:    'Mansion AI Property Search v1.0',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[PUBLIC AI-SEARCH]', err.message);
    res.status(500).json({ success: false, message: err.message });
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
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── GET /agents ───────────────────────────────────────────
// Daftar agen aktif untuk website publik (mansionpro.id/agents)
// Filter: Status Aktif, Tampilkan_di_Web !== 'FALSE', bukan role internal
const MANSION_LOGO_URL = 'https://crm.mansionpro.id/assets/mansion-logo.png';
const HIDDEN_ROLES_PUBLIC = ['superadmin', 'admin', 'kantor'];

router.get('/agents', async (req, res) => {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    if (!rows || rows.length < 2) return res.json({ success: true, data: [] });

    const [, ...data] = rows;
    const agents = data
      .map(row => COLUMNS.AGENTS.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {}))
      .filter(a => a.ID)
      .filter(a => a.Status !== 'Nonaktif')
      .filter(a => !HIDDEN_ROLES_PUBLIC.includes(a.Role))
      .filter(a => a.Tampilkan_di_Web !== 'FALSE')
      .map(a => ({
        id:             a.ID,
        nama:           a.Nama,
        role:           a.Role,
        nama_kantor:    a.Nama_Kantor || 'MANSION Realty',
        foto_url:       a.Foto_URL || MANSION_LOGO_URL,
        listing_count:  parseInt(a.Listing_Count) || 0,
        deal_count:     parseInt(a.Deal_Count)    || 0,
        join_date:      a.Join_Date || '',
        no_wa:          a.No_WA || '',
      }));

    res.json({ success: true, data: agents, count: agents.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
