/**
 * AssetsService
 * ============================================
 * Manajemen Aset Properti Lelang / Eksekusi:
 * - Import/sync data dari external Google Sheet (SSoT bank/lelang)
 * - CRUD aset dengan akses terbatas
 * - Upload foto ke Cloudinary (max 3)
 * - AutoCaption sosmed untuk properti lelang
 * - Toggle publish ke Web Mansion
 *
 * Pemilik: Kantor (bukan individual agen)
 * External Sheet: ASSET_SOURCE_SHEET_ID
 */

const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS, getSheetsClient } = require('../config/sheets.config');
const { v4: uuidv4 } = require('uuid');

const EXTERNAL_SHEET_ID = process.env.ASSET_SOURCE_SHEET_ID || '15LHx3ty0hvhmtOMuJriRftBsXSWvfwLjW59kUucBpVc';

// Tab "Asset Sellable" = output dari bankaset exportSellable() (23 kolom, index 0-22)
const ASSET_SELLABLE_TAB = 'Asset Sellable';

// Konversi assetType enum bankaset → Tipe_Properti CRM
const ASSET_TYPE_MAP = {
  RUMAH: 'Rumah', RUKO: 'Ruko', APARTEMEN: 'Apartemen',
  GUDANG: 'Gudang', PABRIK: 'Gudang', LAHAN: 'Tanah',
  KANTOR: 'Ruko', HOTEL: 'Apartemen', OTHER: 'Properti',
};

class AssetsService {

  // ── GET ALL ──────────────────────────────────────────────
  async getAll(filters = {}) {
    const rows = await sheetsService.getRange(SHEETS.ASSETS);
    if (!rows || rows.length < 2) return [];

    const [, ...data] = rows;
    let assets = data.map(row => this._rowToObj(row)).filter(a => a.ID);

    if (filters.status)     assets = assets.filter(a => a.Status === filters.status);
    if (filters.tipe)       assets = assets.filter(a => a.Tipe_Properti === filters.tipe);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      assets = assets.filter(a =>
        [a.Nama_Asset, a.Nama_Debitur, a.Bank_Kreditur, a.Kota, a.Kecamatan, a.No_Perkara, a.Alamat]
          .join(' ').toLowerCase().includes(q)
      );
    }

    assets.sort((a, b) => new Date(b.Created_At) - new Date(a.Created_At));
    return assets;
  }

  // ── GET BY ID ────────────────────────────────────────────
  async getById(id) {
    const result = await sheetsService.findRowById(SHEETS.ASSETS, id);
    if (!result) return null;
    return this._rowToObj(result.data);
  }

  // ── CREATE ───────────────────────────────────────────────
  async create(data, user) {
    await this._ensureHeaders();
    const now = new Date().toISOString();
    const id  = uuidv4();
    const kode = await this._generateKode(data.Tipe_Properti);

    const obj = {
      ID:                       id,
      Kode_Asset:               kode,
      Tanggal_Input:            now.slice(0, 10),
      Tipe_Properti:            data.Tipe_Properti || 'Rumah',
      Nama_Asset:               data.Nama_Asset || '',
      Nama_Debitur:             data.Nama_Debitur || '',
      No_Perkara:               data.No_Perkara || '',
      Bank_Kreditur:            data.Bank_Kreditur || '',
      Alamat:                   data.Alamat || '',
      Kecamatan:                data.Kecamatan || '',
      Kota:                     data.Kota || '',
      Provinsi:                 data.Provinsi || '',
      Luas_Tanah:               data.Luas_Tanah || '',
      Luas_Bangunan:            data.Luas_Bangunan || '',
      Sertifikat:               data.Sertifikat || '',
      Harga_Limit_Lelang:       String(data.Harga_Limit_Lelang || '0').replace(/[^0-9]/g, ''),
      Harga_Limit_Format:       this._formatHarga(data.Harga_Limit_Lelang),
      Est_Harga_Pasar:          String(data.Est_Harga_Pasar || '').replace(/[^0-9]/g, ''),
      Est_Harga_Pasar_Format:   data.Est_Harga_Pasar ? this._formatHarga(data.Est_Harga_Pasar) : '',
      Est_Harga_Eksekusi:       String(data.Est_Harga_Eksekusi || '').replace(/[^0-9]/g, ''),
      Est_Harga_Eksekusi_Format: data.Est_Harga_Eksekusi ? this._formatHarga(data.Est_Harga_Eksekusi) : '',
      Keterangan_Debitur:       data.Keterangan_Debitur || '',
      Foto_1_URL:               data.Foto_1_URL || '',
      Foto_2_URL:               data.Foto_2_URL || '',
      Foto_3_URL:               data.Foto_3_URL || '',
      Cloudinary_IDs:           data.Cloudinary_IDs ? JSON.stringify(data.Cloudinary_IDs) : '[]',
      Caption_Sosmed:           '',
      Status:                   data.Status || 'Draft',
      Tampilkan_di_Web:         data.Tampilkan_di_Web || 'FALSE',
      Source_Row_ID:            data.Source_Row_ID || '',
      Source_Data:              data.Source_Data ? JSON.stringify(data.Source_Data) : '',
      Created_By_ID:            user?.id || '',
      Created_By_Nama:          user?.nama || '',
      Created_At:               now,
      Updated_At:               now,
      Notes:                    data.Notes || '',
    };

    obj.Caption_Sosmed = this._generateCaption(obj);

    const row = COLUMNS.ASSETS.map(col => obj[col] || '');
    await sheetsService.appendRow(SHEETS.ASSETS, row);
    return obj;
  }

  // ── UPDATE ───────────────────────────────────────────────
  async update(id, data) {
    const result = await sheetsService.findRowById(SHEETS.ASSETS, id);
    if (!result) throw new Error('Aset tidak ditemukan');

    const existing = this._rowToObj(result.data);
    const updated  = { ...existing, ...data, Updated_At: new Date().toISOString() };

    if (Array.isArray(updated.Cloudinary_IDs)) {
      updated.Cloudinary_IDs = updated.Cloudinary_IDs.length === 0
        ? (existing.Cloudinary_IDs || '[]')
        : JSON.stringify(updated.Cloudinary_IDs);
    }

    // Re-format harga fields
    ['Harga_Limit_Lelang', 'Est_Harga_Pasar', 'Est_Harga_Eksekusi'].forEach(field => {
      if (data[field] !== undefined) {
        updated[field] = String(data[field]).replace(/[^0-9]/g, '');
        updated[`${field}_Format`] = updated[field] ? this._formatHarga(updated[field]) : '';
        // Est_Harga_Pasar → Est_Harga_Pasar_Format, Est_Harga_Eksekusi → Est_Harga_Eksekusi_Format
        // Harga_Limit_Lelang → Harga_Limit_Format (special case)
        if (field === 'Harga_Limit_Lelang') {
          updated.Harga_Limit_Format = updated[field] ? this._formatHarga(updated[field]) : '';
          delete updated[`${field}_Format`];
        }
      }
    });

    if (data.Source_Data && typeof data.Source_Data === 'object') {
      updated.Source_Data = JSON.stringify(data.Source_Data);
    }

    // Re-generate caption jika konten berubah
    if (data.Nama_Asset || data.Kota || data.Tipe_Properti || data.Harga_Limit_Lelang) {
      updated.Caption_Sosmed = this._generateCaption(updated);
    }

    const row = COLUMNS.ASSETS.map(col => updated[col] || '');
    await sheetsService.updateRow(SHEETS.ASSETS, result.rowIndex, row);
    return updated;
  }

  // ── DELETE ───────────────────────────────────────────────
  async delete(id) {
    const result = await sheetsService.findRowById(SHEETS.ASSETS, id);
    if (!result) throw new Error('Aset tidak ditemukan');
    await sheetsService.deleteRow(SHEETS.ASSETS, result.rowIndex);
    return true;
  }

  // ── PUBLISH / UNPUBLISH ──────────────────────────────────
  async setStatus(id, status) {
    if (!['Draft', 'Publish'].includes(status)) throw new Error('Status tidak valid');
    const tampilkan = status === 'Publish' ? 'TRUE' : 'FALSE';
    return this.update(id, { Status: status, Tampilkan_di_Web: tampilkan });
  }

  // ── SYNC FROM EXTERNAL SHEET ─────────────────────────────
  // Reads bankaset "Asset Sellable" tab — header-based mapping (tidak bergantung urutan kolom).
  // reset=true: hapus semua data ASSETS lama sebelum sync (clean slate).
  async syncFromSource(user, reset = false) {
    const sheets = getSheetsClient();

    // Fetch external sheet dan CRM ASSETS paralel (2 reads total)
    let extRows, existingRows;
    try {
      [extRows, existingRows] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId: EXTERNAL_SHEET_ID,
          range: ASSET_SELLABLE_TAB,
        }).then(r => r.data.values || []),
        sheetsService.getRange(SHEETS.ASSETS),
      ]);
    } catch (err) {
      throw new Error(
        `Tidak bisa akses tab "${ASSET_SELLABLE_TAB}" di sheet ${EXTERNAL_SHEET_ID}: ${err.message}. ` +
        `Pastikan service account crm-sheets-sa@crm-broker2026.iam.gserviceaccount.com diberi akses Read.`
      );
    }

    if (!extRows || extRows.length < 2) {
      return { created: 0, updated: 0, skipped: 0, errors: [], message: 'External sheet kosong atau hanya berisi header' };
    }

    // Row 0 = header, row 1+ = data
    const sourceHeaders = (extRows[0] || []).map(h => (h || '').trim());
    const dataRows = extRows.slice(1);

    // Header-based column index mapping (case-insensitive, dengan prefix-fallback)
    const hIdx = {};
    sourceHeaders.forEach((h, i) => { hIdx[h.toLowerCase()] = i; });
    const hKeys = Object.keys(hIdx);
    const findCol = (...candidates) => {
      for (const c of candidates) {
        const k = c.toLowerCase();
        // 1) exact match
        if (hIdx[k] !== undefined) return hIdx[k];
        // 2) prefix match: "luas tanah" → "luas tanah (m²)", "rasio sisa pokok" → "rasio sisa pokok/outstanding"
        const found = hKeys.find(h => h.startsWith(k + ' ') || h.startsWith(k + '(') || h.startsWith(k + '/'));
        if (found !== undefined) return hIdx[found];
      }
      return -1;
    };
    const getStr  = (row, ...names) => { const i = findCol(...names); return i >= 0 ? (row[i] || '').trim() : ''; };
    const getNum  = (row, ...names) => { const i = findCol(...names); return i >= 0 ? (parseFloat(row[i] || '0') || 0) : 0; };

    // reset=true: hapus semua data ASSETS (baris 2 ke bawah), simpan header
    if (reset && existingRows && existingRows.length > 1) {
      const ssId = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
      await sheets.spreadsheets.values.clear({
        spreadsheetId: ssId,
        range: `${SHEETS.ASSETS}!A2:AK`,
      });
      existingRows.splice(1); // kosongkan, hanya header
    }

    // Dedup map: Source_Row_ID = assetId dari bankaset
    const existingAssets = existingRows && existingRows.length > 1
      ? existingRows.slice(1).map(r => this._rowToObj(r)).filter(a => a.ID)
      : [];
    const existingBySourceId = {};
    existingAssets.forEach(a => { if (a.Source_Row_ID) existingBySourceId[a.Source_Row_ID] = a; });

    const KODE_PREFIX = {
      Rumah: 'AST-RMH', Ruko: 'AST-RKO', Apartemen: 'AST-APT',
      Gudang: 'AST-GDG', Tanah: 'AST-TNH', Kios: 'AST-KIO',
    };
    const typeCounts = {};
    existingAssets.forEach(a => {
      const p = KODE_PREFIX[a.Tipe_Properti] || 'AST';
      typeCounts[p] = (typeCounts[p] || 0) + 1;
    });

    const year = new Date().getFullYear();
    const now  = new Date().toISOString();
    const results = { created: 0, updated: 0, skipped: 0, errors: [], sourceHeaders };

    const newRows   = [];
    const updateOps = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0 || row.every(c => !c)) continue;

      // Header-based: nama kolom dicari case-insensitive, kandidat alternatif didukung
      const assetId       = getStr(row, 'id aset', 'asset id', 'id', 'kode');
      if (!assetId) { results.skipped++; continue; }

      const bankName      = getStr(row, 'bank', 'bank kreditur', 'nama bank', 'kreditor', 'nama kreditur', 'kreditur', 'lembaga', 'institusi', 'lender') || (row[1] || '').trim();
      const assetTypeRaw  = getStr(row, 'tipe aset', 'tipe', 'jenis', 'type').toUpperCase();
      const city          = getStr(row, 'kota', 'kab/kota', 'kabupaten/kota', 'kabupaten', 'kabkota');
      const district      = getStr(row, 'kecamatan', 'kec');
      const area          = getStr(row, 'area/kelurahan', 'area', 'kelurahan', 'wilayah', 'region');
      const address       = getStr(row, 'alamat lengkap', 'alamat', 'address');
      const marketValue   = getNum(row, 'nilai pasar', 'harga pasar', 'market value');
      const outstanding   = getNum(row, 'outstanding', 'total outstanding', 'sisa kredit');
      const principalOuts = getNum(row, 'sisa pokok', 'principal outstanding');
      const landArea      = (() => { const v = getStr(row, 'luas tanah', 'lt', 'land area'); return v === '-' ? 0 : (parseFloat(v) || 0); })();
      const buildingArea  = (() => { const v = getStr(row, 'luas bangunan', 'lb', 'building area'); return v === '-' ? 0 : (parseFloat(v) || 0); })();
      const certType      = (() => { const v = getStr(row, 'sertifikat', 'tipe sertifikat', 'jenis sertifikat', 'shm/hgb'); return v === '-' ? '' : v; })();
      const debtorName    = (() => { const v = getStr(row, 'debitur', 'nama debitur', 'debtor', 'nama nasabah'); return v === '-' ? '' : v; })();
      const liquidRatio   = getNum(row, 'rasio sisa pokok', 'rasio sisa pokok/outstanding', 'liquid ratio', 'rasio');
      const liquidValue   = getNum(row, 'nilai likuidasi', 'liquid value', 'harga likuidasi', 'nilai likuidasi (rp)');
      const hargaLimit    = getNum(row, 'harga limit', 'limit price', 'harga limit (rp)', 'harga lelang');
      const hargaPasarEst = getNum(row, 'harga pasar estimasi', 'est harga pasar', 'harga pasar est');
      const demandScore   = getStr(row, 'demand score', 'demand', 'score');
      const sellable      = getStr(row, 'sellable', 'terjual', 'status jual');
      const statusSrc     = (getStr(row, 'status', 'status aset') || 'ACTIVE').toUpperCase();
      const createdAtSrc  = getStr(row, 'dibuat', 'created at', 'tanggal input', 'created');
      const updatedAtSrc  = getStr(row, 'diperbarui', 'updated at', 'updated');
      const labelAsset    = getStr(row, 'label asset', 'label', 'jenis lelang', 'jenis', 'kategori', 'tipe lelang');

      if (!bankName && !city && !address && !debtorName) { results.skipped++; continue; }

      const tipeProperti  = ASSET_TYPE_MAP[assetTypeRaw] || 'Properti';
      // col 16 = Harga Limit (limitPrice), col 15 = Nilai Likuidasi (fallback)
      const hargaLimitFinal = hargaLimit > 0 ? hargaLimit : (liquidValue > 0 ? liquidValue : 0);
      const sourceData = {
        assetId, bankName, assetType: assetTypeRaw, area, status: statusSrc,
        outstanding, principalOuts, liquidRatio, liquidValue, hargaLimit,
        hargaPasarEst, demandScore, sellable, labelAsset, createdAtSrc, updatedAtSrc,
      };

      if (existingBySourceId[assetId]) {
        // UPDATE — preserve manual CRM fields (Est_Harga_Pasar, Est_Harga_Eksekusi, Keterangan_Debitur, Foto_*)
        const existing   = existingBySourceId[assetId];
        const updateData = { Source_Data: sourceData };
        const srcFields  = {
          Bank_Kreditur:      bankName,
          Tipe_Properti:      tipeProperti,
          Kota:               city,
          Kecamatan:          district,
          Alamat:             address,
          Luas_Tanah:         landArea > 0      ? String(landArea)      : '',
          Luas_Bangunan:      buildingArea > 0  ? String(buildingArea)  : '',
          Sertifikat:         certType,
          Nama_Debitur:       debtorName,
          Harga_Limit_Lelang: hargaLimitFinal > 0 ? String(hargaLimitFinal) : '',
          Label_Asset:        labelAsset,
        };
        let changed = false;
        for (const [f, v] of Object.entries(srcFields)) {
          if (v && v !== existing[f]) { updateData[f] = v; changed = true; }
        }
        if (changed || existing.Source_Data !== JSON.stringify(sourceData)) {
          updateOps.push({ existing, updateData });
        } else {
          results.skipped++;
        }
      } else {
        // BUILD new row in memory — no GSheet reads
        const prefix = KODE_PREFIX[tipeProperti] || 'AST';
        typeCounts[prefix] = (typeCounts[prefix] || 0) + 1;
        const kode = `${prefix}-${year}-${String(typeCounts[prefix]).padStart(3, '0')}`;
        const id   = uuidv4();

        const obj = {
          ID:                        id,
          Kode_Asset:                kode,
          Tanggal_Input:             now.slice(0, 10),
          Tipe_Properti:             tipeProperti,
          Nama_Asset:                '',
          Nama_Debitur:              debtorName,
          No_Perkara:                '',
          Bank_Kreditur:             bankName,
          Alamat:                    address,
          Kecamatan:                 district,
          Kota:                      city,
          Provinsi:                  '',
          Luas_Tanah:                landArea > 0      ? String(landArea)      : '',
          Luas_Bangunan:             buildingArea > 0  ? String(buildingArea)  : '',
          Sertifikat:                certType,
          Harga_Limit_Lelang:        hargaLimitFinal > 0 ? String(hargaLimitFinal) : '',
          Harga_Limit_Format:        hargaLimitFinal > 0 ? this._formatHarga(hargaLimitFinal) : '',
          Est_Harga_Pasar:           marketValue > 0   ? String(marketValue)   : '',
          Est_Harga_Pasar_Format:    marketValue > 0   ? this._formatHarga(marketValue) : '',
          Est_Harga_Eksekusi:        '',
          Est_Harga_Eksekusi_Format: '',
          Keterangan_Debitur:        '',
          Foto_1_URL:                '',
          Foto_2_URL:                '',
          Foto_3_URL:                '',
          Cloudinary_IDs:            '[]',
          Caption_Sosmed:            '',
          Status:                    'Draft',
          Tampilkan_di_Web:          'FALSE',
          Source_Row_ID:             assetId,
          Source_Data:               JSON.stringify(sourceData),
          Created_By_ID:             user?.id || '',
          Created_By_Nama:           user?.nama || '',
          Created_At:                now,
          Updated_At:                now,
          Notes:                     '',
          Label_Asset:               labelAsset,
        };
        obj.Caption_Sosmed = this._generateCaption(obj);
        newRows.push(COLUMNS.ASSETS.map(col => obj[col] || ''));
        results.created++;
      }
    }

    // Batch insert semua baris baru (1 API call)
    if (newRows.length > 0) {
      await sheetsService.appendRows(SHEETS.ASSETS, newRows);
    }

    // Sequential updates (hanya baris yang berubah)
    for (const { existing, updateData } of updateOps) {
      try {
        await this.update(existing.ID, updateData);
        results.updated++;
      } catch (err) {
        results.errors.push({ assetId: existing.Source_Row_ID, error: err.message });
      }
    }

    results.message = `Sync selesai: ${results.created} baru, ${results.updated} diupdate, ${results.skipped} dilewati`;
    if (results.errors.length) results.message += `, ${results.errors.length} error`;
    return results;
  }

  // ── ASSET EDITORS — CRUD ──────────────────────────────────
  async getEditors() {
    const rows = await sheetsService.getRange(SHEETS.ASSET_EDITORS);
    if (!rows || rows.length < 2) return [];
    return rows.slice(1).map(r => this._editorRowToObj(r)).filter(e => e.ID);
  }

  async addEditor(agenId, agenNama, byUser) {
    await this._ensureEditorHeaders();
    const rows = await sheetsService.getRange(SHEETS.ASSET_EDITORS);
    const existing = (rows || []).slice(1).find(r => r[1] === agenId);
    if (existing) throw new Error('User sudah terdaftar sebagai editor aset');

    const obj = {
      ID:            uuidv4(),
      Agen_ID:       agenId,
      Agen_Nama:     agenNama,
      Added_By_ID:   byUser.id,
      Added_By_Nama: byUser.nama || '',
      Created_At:    new Date().toISOString(),
    };
    const row = COLUMNS.ASSET_EDITORS.map(col => obj[col] || '');
    await sheetsService.appendRow(SHEETS.ASSET_EDITORS, row);
    return obj;
  }

  async removeEditor(agenId) {
    const rows = await sheetsService.getRange(SHEETS.ASSET_EDITORS);
    if (!rows || rows.length < 2) throw new Error('Editor tidak ditemukan');
    const idx = rows.slice(1).findIndex(r => r[1] === agenId);
    if (idx === -1) throw new Error('Editor tidak ditemukan');
    await sheetsService.deleteRow(SHEETS.ASSET_EDITORS, idx + 2);
    return true;
  }

  async isEditor(agenId) {
    const editors = await this.getEditors();
    return editors.some(e => e.Agen_ID === agenId);
  }

  // ── CAPTION BUNDLE ────────────────────────────────────────
  getSosmedBundle(asset) {
    return {
      asset_id:       asset.ID,
      kode:           asset.Kode_Asset,
      caption_ig:     this._generateCaption(asset, 'instagram'),
      caption_fb:     this._generateCaption(asset, 'facebook'),
      caption_tiktok: this._generateCaption(asset, 'tiktok'),
      caption_wa:     this._generateCaptionWA(asset),
      hashtags:       this._buildHashtags(asset),
    };
  }

  generateCaption(asset, platform = 'instagram') {
    return this._generateCaption(asset, platform);
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────

  _rowToObj(row) {
    return COLUMNS.ASSETS.reduce((obj, col, i) => {
      obj[col] = row[i] || '';
      return obj;
    }, {});
  }

  _editorRowToObj(row) {
    return COLUMNS.ASSET_EDITORS.reduce((obj, col, i) => {
      obj[col] = row[i] || '';
      return obj;
    }, {});
  }

  _formatHarga(raw) {
    const num = parseInt(String(raw || '0').replace(/[^0-9]/g, ''));
    if (!num) return '';
    if (num >= 1_000_000_000) {
      const v = num / 1_000_000_000;
      const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
      return `Rp ${s} M`;
    }
    if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(0)} Jt`;
    return `Rp ${num.toLocaleString('id-ID')}`;
  }

  async _generateKode(tipe) {
    const prefix = {
      Rumah: 'AST-RMH', Ruko: 'AST-RKO', Apartemen: 'AST-APT',
      Gudang: 'AST-GDG', Tanah: 'AST-TNH', Kios: 'AST-KIO',
    }[tipe] || 'AST';
    const year = new Date().getFullYear();
    const rows = await sheetsService.getRange(SHEETS.ASSETS);
    const seq  = String((rows ? rows.length : 1)).padStart(3, '0');
    return `${prefix}-${year}-${seq}`;
  }

  async _ensureHeaders() {
    try {
      const rows = await sheetsService.getRange(SHEETS.ASSETS);
      if (!rows || rows.length === 0) {
        await sheetsService.appendRow(SHEETS.ASSETS, COLUMNS.ASSETS);
      }
    } catch (_) {}
  }

  async _ensureEditorHeaders() {
    try {
      const rows = await sheetsService.getRange(SHEETS.ASSET_EDITORS);
      if (!rows || rows.length === 0) {
        await sheetsService.appendRow(SHEETS.ASSET_EDITORS, COLUMNS.ASSET_EDITORS);
      }
    } catch (_) {}
  }

  _generateCaption(asset, platform = 'instagram') {
    const {
      Label_Asset, Tipe_Properti, Alamat, Kota, Kecamatan,
      Harga_Limit_Format, Harga_Limit_Lelang,
      Luas_Tanah, Luas_Bangunan, Sertifikat,
      Keterangan_Debitur,
    } = asset;

    const tipe     = Tipe_Properti || 'Properti';
    const emoji    = { Rumah: '🏡', Ruko: '🏪', Apartemen: '🏢', Gudang: '🏭', Tanah: '🌿', Kios: '🏬' }[tipe] || '🏠';
    const limitFmt = Harga_Limit_Format || this._formatHarga(Harga_Limit_Lelang);
    const alamatFmt = Alamat || [Kecamatan, Kota].filter(Boolean).join(', ') || '—';
    const hashtags = this._buildHashtags(asset);

    // Spek baris
    const spekLines = [
      Luas_Tanah    ? `LT : ${Luas_Tanah} m²` : '',
      Luas_Bangunan ? `LB : ${Luas_Bangunan} m²` : '',
      Sertifikat    ? `Sertifikat : ${Sertifikat}` : '',
    ].filter(Boolean).join('\n');

    // Core body (sama untuk semua platform, styling berbeda)
    const label   = Label_Asset ? `${Label_Asset}\n` : '';
    const catatan = Keterangan_Debitur ? `\n${Keterangan_Debitur}\n` : '';

    if (platform === 'instagram') {
      return `${emoji} HOT ITEM ${emoji}
${label}${tipe}
📍 ${alamatFmt}

📐 Spesifikasi :
${spekLines || '—'}
${catatan}
💰 Best Price : ${limitFmt || 'On Request'}
⚖️ Cash Only | No Viewing | Asset Bank

📲 DM atau hubungi kami untuk info lengkap!

${hashtags}`;
    }

    if (platform === 'facebook') {
      return `🔥 HOT ITEM — PROPERTI LELANG EKSEKUSI

${label}${emoji} ${tipe}
📍 ${alamatFmt}

📐 Spesifikasi :
${spekLines || '—'}
${catatan}
💰 Best Price : ${limitFmt || 'On Request'}
⚖️ Cash Only | No Viewing | Asset Bank

📞 Hubungi kami untuk info lengkap & jadwal!

${hashtags}`;
    }

    if (platform === 'tiktok') {
      return `🔥 HOT ITEM!
${label}${emoji} ${tipe}
📍 ${alamatFmt}
${spekLines ? `📐 ${spekLines.replace(/\n/g, ' | ')}` : ''}
💰 Best Price : ${limitFmt || 'On Request'}
⚖️ Cash Only | No Viewing | Asset Bank
DM untuk info! 👇

${hashtags}`;
    }

    // WA (template tanpa info agen — agen di-inject dari frontend)
    return this._generateCaptionWA(asset);
  }

  _generateCaptionWA(asset, agent = null) {
    const {
      Label_Asset, Tipe_Properti, Alamat, Kota, Kecamatan,
      Harga_Limit_Format, Harga_Limit_Lelang,
      Luas_Tanah, Luas_Bangunan, Sertifikat,
      Keterangan_Debitur,
    } = asset;

    const tipe     = Tipe_Properti || 'Properti';
    const limitFmt = Harga_Limit_Format || this._formatHarga(Harga_Limit_Lelang);
    const alamatFmt = Alamat || [Kecamatan, Kota].filter(Boolean).join(', ') || '—';

    const spekLines = [
      Luas_Tanah    ? `LT : ${Luas_Tanah} m²` : '',
      Luas_Bangunan ? `LB : ${Luas_Bangunan} m²` : '',
    ].filter(Boolean).join('\n');

    const label   = Label_Asset ? `${Label_Asset}\n` : '';
    const catatan = Keterangan_Debitur ? `\n_${Keterangan_Debitur}_\n` : '';

    const hubungi = agent
      ? `\nHubungi :\n*${agent.nama || ''}*\n${agent.no_wa || ''}\n${agent.kantor || ''}`
      : '\nHubungi :\n[Nama Agen]\n[No WA]';

    return `🔥 *HOT ITEM*
${label}*${tipe}*
📍 ${alamatFmt}

📐 *Spesifikasi :*
${spekLines || '—'}
${catatan}
💰 *Best Price : ${limitFmt || 'On Request'}*
_Cash Only, No Viewing, Asset Bank_
${hubungi}`;
  }

  _buildHashtags(asset) {
    const tipe = (asset.Tipe_Properti || '').toLowerCase().replace(/\s/g, '');
    const kota = (asset.Kota || '').toLowerCase().replace(/\s/g, '');
    const kec  = (asset.Kecamatan || '').toLowerCase().replace(/\s/g, '');
    const bank = (asset.Bank_Kreditur || '').replace(/\s/g, '').slice(0, 15);

    const tags = [
      '#lelangproperti', '#propertilelang', '#eksekusijaminan',
      `#lelang${tipe}`, `#properti${tipe}`,
      kota ? `#${tipe}${kota}` : '',
      kota ? `#properti${kota}` : '',
      kota ? `#lelang${kota}` : '',
      kec  ? `#${kec}` : '',
      bank ? `#${bank.toLowerCase()}` : '',
      '#investasiproperti', '#jualproperti', '#propertimurah',
      '#bawahahargapasar', '#propertiindonesia',
    ].filter(t => t && t.length > 3);

    return [...new Set(tags)].slice(0, 14).join(' ');
  }
}

module.exports = new AssetsService();
