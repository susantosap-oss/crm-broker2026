/**
 * KnowledgeService
 * ============================================
 * Manajemen Dokumen Template Knowledge Center
 * Sumber data: Google Sheet terpisah (KNOWLEDGE_DOCS_SHEET_ID)
 *
 * Struktur tab "Dokumen" di Sheet:
 *   A: ID         (contoh: D01)
 *   B: Title      (nama dokumen)
 *   C: Category   (Lelang | Cessie | AYDA | Legal | SOP)
 *   D: Description
 *   E: File_URL   (Google Drive link atau Cloudinary URL)
 *   F: Icon       (emoji, default 📄)
 *   G: Status     (Active | Draft)
 *
 * Row 1 = header, data mulai row 2.
 */

const { getGoogleAuth } = require('../config/sheets.config');
const { google } = require('googleapis');
const NodeCache = require('node-cache');

const SHEET_ID  = process.env.KNOWLEDGE_DOCS_SHEET_ID || '';
const TAB_NAME  = 'Dokumen';
const CACHE_TTL = 300; // 5 menit

const _cache = new NodeCache({ stdTTL: CACHE_TTL });

function _sheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

function _rowToDoc(row, idx) {
  return {
    id:          (row[0] || '').trim() || `D${String(idx).padStart(2,'0')}`,
    title:       (row[1] || '').trim(),
    category:    (row[2] || '').trim(),
    description: (row[3] || '').trim(),
    fileUrl:     (row[4] || '').trim(),
    icon:        (row[5] || '📄').trim(),
    status:      (row[6] || 'Active').trim(),
  };
}

async function _ensureTab(sheets) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const exists = meta.data.sheets.some(s => s.properties.title === TAB_NAME);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
        },
      });
      // Tulis header
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['ID','Title','Category','Description','File_URL','Icon','Status']] },
      });
    }
  } catch(e) {
    // Jika sheet tidak ditemukan atau ID belum diset, skip
  }
}

// ── GET semua dokumen ──────────────────────────────────────
async function getDocs({ includeAll = false } = {}) {
  if (!SHEET_ID) return { docs: [], error: 'KNOWLEDGE_DOCS_SHEET_ID belum diset di environment' };

  const cacheKey = includeAll ? 'docs_all' : 'docs_active';
  const cached = _cache.get(cacheKey);
  if (cached) return { docs: cached };

  try {
    const sheets = _sheetsClient();
    await _ensureTab(sheets);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A2:G`,
    });

    const rows = res.data.values || [];
    let docs = rows
      .filter(r => r[1] && r[1].trim()) // harus ada Title
      .map((r, i) => _rowToDoc(r, i + 2));

    if (!includeAll) docs = docs.filter(d => d.status === 'Active');

    _cache.set(cacheKey, docs);
    return { docs };
  } catch(e) {
    return { docs: [], error: e.message };
  }
}

// ── ADD dokumen baru ───────────────────────────────────────
async function addDoc({ id, title, category, description, fileUrl, icon, status }) {
  if (!SHEET_ID) throw new Error('KNOWLEDGE_DOCS_SHEET_ID belum diset');
  if (!title)    throw new Error('Title wajib diisi');
  if (!category) throw new Error('Category wajib diisi');

  const sheets = _sheetsClient();
  await _ensureTab(sheets);

  // Auto-generate ID jika tidak ada
  if (!id) {
    const { docs } = await getDocs({ includeAll: true });
    const maxNum = docs.reduce((m, d) => {
      const n = parseInt((d.id || '').replace(/\D/g,'')) || 0;
      return Math.max(m, n);
    }, 0);
    id = 'D' + String(maxNum + 1).padStart(2, '0');
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        id,
        title,
        category,
        description || '',
        fileUrl,
        icon || '📄',
        status || 'Active',
      ]],
    },
  });

  _cache.del('docs_all');
  _cache.del('docs_active');
  return { id, title, category, description, fileUrl, icon, status: status || 'Active' };
}

// ── UPDATE dokumen ─────────────────────────────────────────
async function updateDoc(docId, fields) {
  if (!SHEET_ID) throw new Error('KNOWLEDGE_DOCS_SHEET_ID belum diset');

  const sheets = _sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:A`,
  });

  const ids = (res.data.values || []).map(r => (r[0] || '').trim());
  const rowIdx = ids.indexOf(docId); // 0-based; row 0 = header A1
  if (rowIdx < 1) throw new Error('Dokumen tidak ditemukan: ' + docId);

  const sheetRow = rowIdx + 1; // 1-based sheet row
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${sheetRow}:G${sheetRow}`,
  });
  const cur = (current.data.values || [[]])[0] || [];

  const updated = [
    docId,
    fields.title       ?? cur[1] ?? '',
    fields.category    ?? cur[2] ?? '',
    fields.description ?? cur[3] ?? '',
    fields.fileUrl     ?? cur[4] ?? '',
    fields.icon        ?? cur[5] ?? '📄',
    fields.status      ?? cur[6] ?? 'Active',
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A${sheetRow}:G${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [updated] },
  });

  _cache.del('docs_all');
  _cache.del('docs_active');
  return _rowToDoc(updated, sheetRow);
}

// ── DELETE (set status Draft) ──────────────────────────────
async function deleteDoc(docId) {
  return updateDoc(docId, { status: 'Draft' });
}

module.exports = { getDocs, addDoc, updateDoc, deleteDoc };
