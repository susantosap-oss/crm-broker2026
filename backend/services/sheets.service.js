/**
 * SheetsService - Data Access Layer
 * ============================================
 * Semua operasi CRUD ke Google Sheets ada di sini.
 * Controller tidak boleh akses Sheets langsung.
 */

const { getSheetsClient, getGoogleAuth, SPREADSHEET_ID, SHEETS } = require('../config/sheets.config');
const { google } = require('googleapis');
const NodeCache = require('node-cache');

async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      const isQuota = err?.code === 429 || err?.status === 429 ||
        (err?.message||'').includes('quota') || (err?.message||'').includes('rate');
      if (isQuota && i < maxRetries - 1) {
        const wait = (i + 1) * 2000;
        console.warn(`[Sheets] Quota hit, retry ${i+1}/${maxRetries} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      } else throw err;
    }
  }
}



// Cache instance (TTL dari env)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || process.env.CACHE_TTL_LISTINGS || 30),
  checkperiod: 10,
});

class SheetsService {
  constructor() {
    this.sheets = getSheetsClient();
    this.spreadsheetId = SPREADSHEET_ID;
  }

  // ── Generic Read ──────────────────────────────────────────
  async getRange(sheetName, range = null) {
    const cacheKey = `${sheetName}:${range || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const fullRange = range ? `${sheetName}!${range}` : `${sheetName}`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: fullRange,
    });

    const data = res.data.values || [];
    cache.set(cacheKey, data);
    return data;
  }

  // ── Generic Write (Append Row) ────────────────────────────
  async appendRow(sheetName, values) {
    cache.del(`${sheetName}:all`);
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [values] },
    });
    return res.data.updates;
  }

  // ── Batch Append Multiple Rows (1 API call) ──────────────
  async appendRows(sheetName, rows) {
    if (!rows || rows.length === 0) return;
    cache.del(`${sheetName}:all`);
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: rows },
    });
    return res.data.updates;
  }

  // ── Generic Update (Update by Row Number) ────────────────
  async updateRow(sheetName, rowIndex, values) {
    cache.del(`${sheetName}:all`);
    const range = `${sheetName}!A${rowIndex}`;
    const res = await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
    });
    return res.data;
  }

  // ── Find Row by ID (Column A) ─────────────────────────────
  async findRowById(sheetName, id) {
    const rows = await this.getRange(sheetName);
    const rowIndex = rows.findIndex((row) => row[0] === id);
    if (rowIndex === -1) return null;
    return { rowIndex: rowIndex + 1, data: rows[rowIndex] };
  }

  // ── Get All as Objects ────────────────────────────────────
  async getAllAsObjects(sheetName, columnDefs) {
    const rows = await this.getRange(sheetName);
    if (rows.length < 2) return []; // First row = header

    const [headers, ...data] = rows;
    return data.map((row) =>
      columnDefs.reduce((obj, col, i) => {
        obj[col] = row[i] || '';
        return obj;
      }, {})
    );
  }

  // ── Batch Update Multiple Cells ───────────────────────────
  async batchUpdate(data) {
    cache.flushAll();
    const res = await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });
    return res.data;
  }

  // ── Get Rows (skip header row, return array of arrays) ────
  // Dipakai oleh pa.service.js, vigen.service.js
  async getRows(sheetName) {
    const all = await this.getRange(sheetName);
    if (all.length < 2) return [];
    return all.slice(1); // Skip header row 1
  }

  // ── Update Specific Cells dalam Satu Row ──────────────────
  // updates: { colIndex: value, ... }  (0-based column index)
  // rowIndex: 1-based (misal row 2 = rowIndex 2)
  async updateRowCells(sheetName, rowIndex, updates) {
    cache.del(`${sheetName}:all`);

    // Ambil row data sekarang untuk isi kolom yang tidak diupdate
    const all  = await this.getRange(sheetName);
    const row  = all[rowIndex - 1] ? [...all[rowIndex - 1]] : [];

    // Terapkan updates
    const maxIdx = Math.max(...Object.keys(updates).map(Number));
    while (row.length <= maxIdx) row.push('');
    for (const [colIdx, val] of Object.entries(updates)) {
      row[parseInt(colIdx)] = val ?? '';
    }

    await this.updateRow(sheetName, rowIndex, row);
  }

  // ── Clear Cache ───────────────────────────────────────────
  clearCache(sheetName = null) {
    if (sheetName) {
      cache.del(`${sheetName}:all`);
    } else {
      cache.flushAll();
    }
  }

  // ── Ensure Sheet Tab Exists (buat jika belum ada) ─────────
  async ensureSheet(sheetName, headers = []) {
    try {
      const authClient = await getGoogleAuth().getClient();
      const sheetsApi  = google.sheets({ version: 'v4', auth: authClient });
      const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      const exists = meta.data.sheets.some(s => s.properties.title === sheetName);
      if (!exists) {
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        });
        console.log(`✅ [Sheets] Tab "${sheetName}" berhasil dibuat`);
        if (headers.length) {
          await this.updateRow(sheetName, 1, headers);
          console.log(`✅ [Sheets] Headers "${sheetName}" berhasil diisi`);
        }
      }
      return true;
    } catch (e) {
      console.warn(`[Sheets] ensureSheet "${sheetName}" gagal:`, e.message);
      return false;
    }
  }

  async deleteRow(sheetName, rowIndex) {
    const authClient = await getGoogleAuth().getClient();
    const sheetsApi = google.sheets({ version: 'v4', auth: authClient });
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error("Sheet not found");
    const sheetId = sheet.properties.sheetId;
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex-1, endIndex: rowIndex }}}]}
    });
    cache.del(`${sheetName}:all`);
  }

  // ── Get Sheet Stats ───────────────────────────────────────
  async getSheetStats() {
    const [listings, leads, agents] = await Promise.all([
      this.getRange(SHEETS.LISTING),
      this.getRange(SHEETS.LEADS),
      this.getRange(SHEETS.AGENTS),
    ]);

    return {
      totalListings: Math.max(0, listings.length - 1),
      totalLeads: Math.max(0, leads.length - 1),
      totalAgents: Math.max(0, agents.length - 1),
    };
  }
}

module.exports = new SheetsService();
