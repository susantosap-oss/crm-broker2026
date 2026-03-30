/**
 * ListingsService
 * ============================================
 * Business logic untuk manajemen listing properti.
 * Termasuk: CRUD, filter, Social Media Asset Bundle.
 */

const sheetsService = require('./sheets.service');
const cloudinaryService = require('./cloudinary.service');
const captionService = require('./caption.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');
const { v4: uuidv4 } = require('uuid');

// Lazy require untuk hindari circular dependency
function getNotifyCoOwns() {
  return require('../routes/listing_agents.routes').notifyCoOwns;
}

class ListingsService {
  // ── Get All Listings ──────────────────────────────────────
  async getAll(filters = {}) {
    const rows = await sheetsService.getRange(SHEETS.LISTING);
    if (!rows.length) return [];

    const [, ...data] = rows; // skip header
    let listings = data.map((row) => this._rowToObject(row));

    // ── Apply Filters ─────────────────────────────────────
    if (filters.status)           listings = listings.filter(l => l.Status_Listing === filters.status);
    if (filters.tipe)             listings = listings.filter(l => l.Tipe_Properti === filters.tipe);
    if (filters.agen_id)          listings = listings.filter(l => l.Agen_ID === filters.agen_id);
    if (filters.kota)             listings = listings.filter(l => l.Kota?.toLowerCase().includes(filters.kota.toLowerCase()));
    if (filters.search) {
      const q = filters.search.toLowerCase();
      listings = listings.filter(l =>
        [l.Judul, l.Kota, l.Kecamatan, l.Kode_Listing, l.Deskripsi, l.Tipe_Properti]
          .join(' ').toLowerCase().includes(q)
      );
    }
    if (filters.tampilkan_di_web) listings = listings.filter(l => l.Tampilkan_di_Web === 'TRUE');
    if (filters.featured)         listings = listings.filter(l => l.Featured === 'TRUE');

    // ── Limit (for dashboard preview etc.) ─────────────────
    if (filters.limit) listings = listings.slice(0, parseInt(filters.limit));

    return listings;
  }

  // ── Get Single Listing ────────────────────────────────────
  async getById(id) {
    const result = await sheetsService.findRowById(SHEETS.LISTING, id);
    if (!result) return null;
    return this._rowToObject(result.data);
  }

  // ── Create Listing ────────────────────────────────────────
  async create(payload, agentData) {
    const id = uuidv4();
    const kode = await this._generateKode(payload.Tipe_Properti);
    const now = new Date().toISOString();

    // Auto-generate caption sosmed jika tidak diisi
    let captionSosmed = payload.Caption_Sosmed;
    if (!captionSosmed) {
      captionSosmed = captionService.generate(payload);
    }

    const row = this._buildRow({
      ...payload,
      ID: id,
      Kode_Listing: kode,
      Caption_Sosmed: captionSosmed,
      Agen_ID: agentData.id,
      Agen_Nama: agentData.nama,
      Tampilkan_di_Web: payload.Tampilkan_di_Web || 'TRUE',
      Views_Count: '0',
      Created_At: now,
      Updated_At: now,
    });

    await sheetsService.appendRow(SHEETS.LISTING, row);
    return { id, kode, ...payload };
  }

  // ── Update Listing ────────────────────────────────────────
  async update(id, payload, updaterData = null) {
    const existing = await sheetsService.findRowById(SHEETS.LISTING, id);
    if (!existing) throw new Error('Listing tidak ditemukan');

    const merged = { ...this._rowToObject(existing.data), ...payload, Updated_At: new Date().toISOString() };
    const row = this._buildRow(merged);

    await sheetsService.updateRow(SHEETS.LISTING, existing.rowIndex, row);

    // Kirim notif ke Co-Own jika ada updater info (bukan update internal seperti views/caption)
    if (updaterData?.id && updaterData?.nama) {
      try {
        const notifyCoOwns = getNotifyCoOwns();
        await notifyCoOwns(
          id,
          'listing_updated',
          'Listing Diperbarui',
          `Owner telah memperbarui listing ${merged.Kode_Listing} (${merged.Judul})`,
          updaterData.id,
          updaterData.nama
        );
      } catch (e) {
        console.error('[NOTIF UPDATE ERROR]', e.message);
      }
    }

    return merged;
  }

  // ── Toggle Web Visibility ─────────────────────────────────
  async toggleWebVisibility(id, value) {
    return this.update(id, { Tampilkan_di_Web: value ? 'TRUE' : 'FALSE' });
  }

  // ── Social Media Asset Bundle ─────────────────────────────
  async getSocialMediaBundle(id) {
    const listing = await this.getById(id);
    if (!listing) throw new Error('Listing tidak ditemukan');

    // Build download URLs from Cloudinary
    const photoUrls = [];
    if (listing.Foto_Utama_URL) photoUrls.push(listing.Foto_Utama_URL);

    if (listing.Foto_Gallery) {
      try {
        const gallery = JSON.parse(listing.Foto_Gallery);
        photoUrls.push(...gallery);
      } catch (e) { /* skip */ }
    }

    const downloadLinks = photoUrls.map((url, i) => ({
      name: `${listing.Kode_Listing}_foto_${i + 1}.jpg`,
      url: cloudinaryService.getDownloadUrl(url),
      thumbnail: cloudinaryService.getThumbnailUrl(url, 200, 200),
    }));

    return {
      listing_id: id,
      kode: listing.Kode_Listing,
      caption_ig:     this._formatCaption(listing.Caption_Sosmed, 'instagram'),
      caption_tiktok: this._formatCaption(listing.Caption_Sosmed, 'tiktok'),
      caption_fb:     this._formatCaption(listing.Caption_Sosmed, 'facebook'),
      download_links: downloadLinks,
      hashtags:       this._extractHashtags(listing.Caption_Sosmed),
    };
  }

  // ── Increment View Counter ────────────────────────────────
  async incrementView(id) {
    const existing = await sheetsService.findRowById(SHEETS.LISTING, id);
    if (!existing) return;
    const listing = this._rowToObject(existing.data);
    const newCount = (parseInt(listing.Views_Count) || 0) + 1;
    await this.update(id, { Views_Count: String(newCount) });
    return newCount;
  }

  // ── Private Helpers ───────────────────────────────────────
  _rowToObject(row) {
    return COLUMNS.LISTING.reduce((obj, col, i) => {
      obj[col] = row[i] || '';
      return obj;
    }, {});
  }

  _buildRow(obj) {
    return COLUMNS.LISTING.map((col) => obj[col] || '');
  }

  _formatCaption(caption, platform) {
    if (!caption) return '';
    const platformLimits = { instagram: 2200, tiktok: 2200, facebook: 63206 };
    const limit = platformLimits[platform] || 2200;
    return caption.length > limit ? caption.substring(0, limit - 3) + '...' : caption;
  }

  _extractHashtags(text) {
    if (!text) return [];
    const matches = text.match(/#\w+/g);
    return matches || [];
  }

  async _generateKode(tipe) {
    const prefix = {
      'Rumah': 'RMH',
      'Ruko': 'RKO',
      'Tanah': 'TNH',
      'Apartemen': 'APT',
      'Gudang': 'GDG',
    }[tipe] || 'LST';

    const year = new Date().getFullYear();
    const stats = await sheetsService.getSheetStats();
    const seq = String(stats.totalListings + 1).padStart(3, '0');
    return `${prefix}-${year}-${seq}`;
  }
}

module.exports = new ListingsService();
