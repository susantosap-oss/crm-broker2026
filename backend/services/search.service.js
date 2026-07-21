/**
 * PropertySearchService — Core Search Engine
 * ============================================
 * Phase 1: Structured Property Search
 *
 * Architecture Layers:
 *   API Layer   → search.routes.js / public.routes.js
 *   Service     → search.service.js  ← you are here
 *   Repository  → sheets.service.js (cached, 30s TTL)
 *   Data Source → Google Sheets (SSoT)
 *
 * Supported filters: keyword, property_type, transaction_type,
 *   city, area, cluster, developer, price_min/max,
 *   bedroom_min, bathroom_min, land_area_min/max,
 *   building_area_min/max, status, agent_id, featured
 *
 * Supported sort: terbaru | terlama | harga_termurah |
 *   harga_termahal | terpopuler
 *
 * AI-Ready: Phase 2 AI layer hanya perlu memanggil search()
 *   dengan JSON filter — engine ini tidak berubah.
 */

'use strict';

const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

// ── Utility Functions ──────────────────────────────────────

/**
 * Parse numeric value from sheet strings.
 * Handles: "2000000000", "2.5", "150" etc.
 */
function _parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Normalize string: lowercase + trim for comparison */
function _norm(val) {
  return String(val || '').toLowerCase().trim();
}

/** Map raw sheet row array to structured object */
function _rowToListing(row) {
  return COLUMNS.LISTING.reduce((obj, col, i) => {
    obj[col] = row[i] !== undefined ? row[i] : '';
    return obj;
  }, {});
}

/** Build foto gallery array from listing */
function _buildGallery(listing) {
  if (listing.Foto_Gallery) {
    try { return JSON.parse(listing.Foto_Gallery); } catch { /* fall through */ }
  }
  return [listing.Foto_2_URL, listing.Foto_3_URL].filter(Boolean);
}

/**
 * Build public-safe result object.
 * Does NOT expose: Agen_ID, Caption_Sosmed, Cloudinary_IDs,
 *   Notes, Link_GMaps_Personal, Nama_Pemilik
 */
function _toPublicResult(listing) {
  return {
    id:               listing.ID,
    kode:             listing.Kode_Listing,
    judul:            listing.Judul,
    deskripsi:        listing.Deskripsi,
    property_type:    listing.Tipe_Properti,
    transaction_type: listing.Status_Transaksi,
    status:           listing.Status_Listing,
    harga:            _parseNum(listing.Harga),
    harga_format:     listing.Harga_Format,
    harga_permeter:   _parseNum(listing.Harga_Permeter),
    alamat:           listing.Alamat,
    kecamatan:        listing.Kecamatan,
    kota:             listing.Kota,
    provinsi:         listing.Provinsi,
    luas_tanah:       _parseNum(listing.Luas_Tanah),
    luas_bangunan:    _parseNum(listing.Luas_Bangunan),
    kamar_tidur:      _parseNum(listing.Kamar_Tidur),
    kamar_mandi:      _parseNum(listing.Kamar_Mandi),
    garasi:           _parseNum(listing.Garasi),
    lantai:           _parseNum(listing.Lantai),
    sertifikat:       listing.Sertifikat,
    kondisi:          listing.Kondisi,
    fasilitas:        _parseFasilitas(listing.Fasilitas),
    foto_utama:       listing.Foto_Utama_URL,
    foto_gallery:     _buildGallery(listing),
    featured:         listing.Featured === 'TRUE',
    koordinat: {
      lat: listing.Koordinat_Lat,
      lng: listing.Koordinat_Lng,
    },
    maps_url:    listing.Maps_URL,
    views:       _parseNum(listing.Views_Count),
    project_id:  listing.Project_ID || null,
    created_at:  listing.Created_At,
    updated_at:  listing.Updated_At,
  };
}

/** Internal result includes agent data */
function _toInternalResult(listing) {
  return {
    ..._toPublicResult(listing),
    agen_id:          listing.Agen_ID,
    agen_nama:        listing.Agen_Nama,
    team_id:          listing.Team_ID,
    tampilkan_di_web: listing.Tampilkan_di_Web === 'TRUE',
    karakter_properti: listing.Karakter_Properti,
  };
}

function _parseFasilitas(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

// ── Search Service Class ───────────────────────────────────

class PropertySearchService {

  /**
   * Main search method.
   *
   * @param {Object} params          - Filter + pagination + sort params
   * @param {Object} options
   * @param {boolean} options.publicOnly     - If true: only Tampilkan_di_Web=TRUE
   * @param {boolean} options.internalMode   - If true: include agen data in results
   * @returns {SearchResult}
   */
  async search(params = {}, { publicOnly = false, internalMode = false } = {}) {
    // Repository: get all listings (cached by sheetsService)
    const rows = await sheetsService.getRange(SHEETS.LISTING);
    if (!rows || rows.length < 2) return this._emptyResult(params);

    const [, ...data] = rows;
    let listings = data
      .map(_rowToListing)
      .filter(l => l.ID); // skip empty/header rows

    // Public filter: only listings visible to website
    if (publicOnly) {
      listings = listings.filter(l => l.Tampilkan_di_Web === 'TRUE');
    }

    // Apply all search filters
    listings = this._applyFilters(listings, params);

    // Sort
    listings = this._applySort(listings, params.sort);

    // Record total BEFORE pagination
    const total = listings.length;

    // Paginate
    const { page, limit, offset } = this._parsePagination(params);
    const pageData = listings.slice(offset, offset + limit);

    // Map to output format
    const mapper = internalMode ? _toInternalResult : _toPublicResult;
    const results = pageData.map(mapper);

    return {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      results,
    };
  }

  /**
   * Filter options for UI dropdowns / faceted search.
   * Returns unique values for each categorical field.
   */
  async getFilterOptions({ publicOnly = false } = {}) {
    const rows = await sheetsService.getRange(SHEETS.LISTING);
    if (!rows || rows.length < 2) return this._emptyOptions();

    const [, ...data] = rows;
    let listings = data.map(_rowToListing).filter(l => l.ID);

    if (publicOnly) {
      listings = listings.filter(l => l.Tampilkan_di_Web === 'TRUE');
    }

    const unique = (key) =>
      [...new Set(listings.map(l => l[key]).filter(Boolean))].sort();

    const prices = listings
      .map(l => _parseNum(l.Harga))
      .filter(p => p > 0);

    return {
      property_types:    unique('Tipe_Properti'),
      transaction_types: unique('Status_Transaksi'),
      cities:            unique('Kota'),
      areas:             unique('Kecamatan'),
      statuses:          unique('Status_Listing'),
      sertifikat:        unique('Sertifikat'),
      harga_min:         prices.length ? Math.min(...prices) : 0,
      harga_max:         prices.length ? Math.max(...prices) : 0,
    };
  }

  // ── Filter Engine ──────────────────────────────────────────

  _applyFilters(listings, params) {
    const {
      keyword,
      property_type,
      transaction_type,
      city,
      area,
      cluster,
      developer,
      price_min,
      price_max,
      bedroom_min,
      bathroom_min,
      garage_min,
      land_area_min,
      land_area_max,
      building_area_min,
      building_area_max,
      status,
      agent_id,
      featured,
    } = params;

    return listings.filter(l => {
      // ── Keyword ────────────────────────────────────────────
      // Searches: Judul, Deskripsi, Alamat, Kecamatan, Kota,
      //           Kode_Listing, Karakter_Properti
      if (keyword) {
        const q = _norm(keyword);
        const haystack = [
          l.Judul,
          l.Deskripsi,
          l.Alamat,
          l.Kecamatan,
          l.Kota,
          l.Kode_Listing,
          l.Karakter_Properti,
        ].map(_norm).join(' ');
        if (!haystack.includes(q)) return false;
      }

      // ── Property Type ──────────────────────────────────────
      // Exact match, case-insensitive (e.g. "Rumah", "Tanah")
      if (property_type && _norm(l.Tipe_Properti) !== _norm(property_type)) return false;

      // ── Transaction Type ───────────────────────────────────
      // "Dijual" or "Disewakan"
      if (transaction_type && _norm(l.Status_Transaksi) !== _norm(transaction_type)) return false;

      // ── City ───────────────────────────────────────────────
      // Partial match (e.g. "Surabaya" matches "Surabaya Barat")
      if (city && !_norm(l.Kota).includes(_norm(city))) return false;

      // ── Area (Kecamatan) ───────────────────────────────────
      // Partial match on Kecamatan OR Alamat
      if (area) {
        const areaQ = _norm(area);
        const inArea    = _norm(l.Kecamatan).includes(areaQ);
        const inAddress = _norm(l.Alamat).includes(areaQ);
        if (!inArea && !inAddress) return false;
      }

      // ── Cluster ────────────────────────────────────────────
      // Cluster name is embedded in Alamat field
      if (cluster && !_norm(l.Alamat).includes(_norm(cluster))) return false;

      // ── Developer ─────────────────────────────────────────
      // Searched in Judul + Deskripsi + Alamat
      if (developer) {
        const devQ    = _norm(developer);
        const devText = [l.Judul, l.Deskripsi, l.Alamat].map(_norm).join(' ');
        if (!devText.includes(devQ)) return false;
      }

      // ── Price Range ────────────────────────────────────────
      const harga = _parseNum(l.Harga);
      if (price_min && harga < Number(price_min)) return false;
      if (price_max && harga > Number(price_max)) return false;

      // ── Bedrooms ───────────────────────────────────────────
      if (bedroom_min && _parseNum(l.Kamar_Tidur) < Number(bedroom_min)) return false;

      // ── Bathrooms ──────────────────────────────────────────
      if (bathroom_min && _parseNum(l.Kamar_Mandi) < Number(bathroom_min)) return false;

      // ── Garage ────────────────────────────────────────────
      if (garage_min && _parseNum(l.Garasi) < Number(garage_min)) return false;

      // ── Land Area Range ────────────────────────────────────
      const lt = _parseNum(l.Luas_Tanah);
      if (land_area_min && lt < Number(land_area_min)) return false;
      if (land_area_max && lt > Number(land_area_max)) return false;

      // ── Building Area Range ────────────────────────────────
      const lb = _parseNum(l.Luas_Bangunan);
      if (building_area_min && lb < Number(building_area_min)) return false;
      if (building_area_max && lb > Number(building_area_max)) return false;

      // ── Listing Status ────────────────────────────────────
      // "Aktif" | "Nonaktif" | "Terjual" | "Disewa"
      if (status && _norm(l.Status_Listing) !== _norm(status)) return false;

      // ── Agent ID (internal use) ───────────────────────────
      if (agent_id && l.Agen_ID !== String(agent_id)) return false;

      // ── Featured Only ─────────────────────────────────────
      if (featured === 'true' || featured === true) {
        if (l.Featured !== 'TRUE') return false;
      }

      return true;
    });
  }

  // ── Sort Engine ────────────────────────────────────────────

  _applySort(listings, sort = 'terbaru') {
    const arr = [...listings]; // never mutate original
    switch (sort) {
      case 'terlama':
        return arr.sort((a, b) => new Date(a.Created_At) - new Date(b.Created_At));

      case 'harga_termurah':
        return arr.sort((a, b) => _parseNum(a.Harga) - _parseNum(b.Harga));

      case 'harga_termahal':
        return arr.sort((a, b) => _parseNum(b.Harga) - _parseNum(a.Harga));

      case 'terpopuler':
        return arr.sort((a, b) => _parseNum(b.Views_Count) - _parseNum(a.Views_Count));

      case 'terbaru':
      default:
        return arr.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));
    }
  }

  // ── Pagination ─────────────────────────────────────────────

  _parsePagination(params) {
    const page  = Math.max(1, parseInt(params.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
    return { page, limit, offset: (page - 1) * limit };
  }

  // ── Helpers ────────────────────────────────────────────────

  _emptyResult(params) {
    const { page, limit } = this._parsePagination(params);
    return { total: 0, page, limit, total_pages: 0, results: [] };
  }

  _emptyOptions() {
    return {
      property_types: [], transaction_types: [], cities: [],
      areas: [], statuses: [], sertifikat: [], harga_min: 0, harga_max: 0,
    };
  }
}

module.exports = new PropertySearchService();
