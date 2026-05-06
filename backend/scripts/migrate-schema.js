/**
 * migrate-schema.js — One-time schema migration
 * Jalankan: node backend/scripts/migrate-schema.js
 *
 * Yang dilakukan:
 * 1. LISTING  → tambah kolom AR: Nama_Pemilik
 * 2. LEADS    → tambah kolom AI: FU_Tanggal, AJ: FU_Keterangan
 * 3. RENTAL_STATUS → tambah kolom N-S (Agen_Listing, Agen_Selling, CoBroke, Hasil_FU_Reminder)
 * 4. PAYMENT_STAGES → buat tab baru + header
 *
 * Idempotent: cek dulu apakah kolom/tab sudah ada sebelum menulis.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const PRIVATE_KEY     = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const CLIENT_EMAIL    = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

if (!SPREADSHEET_ID) {
  console.error('❌ Env var GOOGLE_SHEETS_ID tidak ditemukan');
  process.exit(1);
}

async function getAuth() {
  if (PRIVATE_KEY && CLIENT_EMAIL) {
    const auth = new google.auth.JWT({
      email: CLIENT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();
    return auth;
  }
  // Fallback ke Application Default Credentials (gcloud auth login)
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

async function getSheetHeaders(sheets, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!1:1`,
    });
    return res.data.values?.[0] || [];
  } catch (_) {
    return null; // sheet tidak ada
  }
}

async function writeCell(sheets, sheetName, cell, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${cell}`,
    valueInputOption: 'RAW',
    resource: { values: [[value]] },
  });
}

async function writeHeaders(sheets, sheetName, startCol, headers) {
  const colLetter = startCol;
  const endCol    = colIndexToLetter(letterToColIndex(startCol) + headers.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${startCol}1:${endCol}1`,
    valueInputOption: 'RAW',
    resource: { values: [headers] },
  });
}

async function createSheet(sheets, title, headers) {
  // Buat tab baru
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        addSheet: { properties: { title } },
      }],
    },
  });
  console.log(`  ✅ Tab "${title}" dibuat`);

  // Tulis header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    resource: { values: [headers] },
  });
  console.log(`  ✅ Header "${title}" ditulis`);
}

function letterToColIndex(col) {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n; // 1-based
}

function colIndexToLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function run() {
  console.log('🚀 Migrate Schema — Mansion CRM\n');
  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ─────────────────────────────────────────────
  // 1. LISTING → tambah AR: Nama_Pemilik
  // ─────────────────────────────────────────────
  console.log('📋 LISTING...');
  const listingHeaders = await getSheetHeaders(sheets, 'LISTING');
  if (listingHeaders && !listingHeaders.includes('Nama_Pemilik')) {
    const nextCol = colIndexToLetter(listingHeaders.length + 1); // setelah kolom terakhir
    await writeCell(sheets, 'LISTING', `${nextCol}1`, 'Nama_Pemilik');
    console.log(`  ✅ Kolom Nama_Pemilik ditambah di ${nextCol}`);
  } else {
    console.log('  ⏭  Nama_Pemilik sudah ada, skip');
  }

  // ─────────────────────────────────────────────
  // 2. LEADS → tambah AI: FU_Tanggal, AJ: FU_Keterangan
  // ─────────────────────────────────────────────
  console.log('📋 LEADS...');
  const leadsHeaders = await getSheetHeaders(sheets, 'LEADS');
  if (leadsHeaders) {
    const newCols = [];
    if (!leadsHeaders.includes('FU_Tanggal'))    newCols.push('FU_Tanggal');
    if (!leadsHeaders.includes('FU_Keterangan')) newCols.push('FU_Keterangan');
    if (newCols.length > 0) {
      const startIdx = leadsHeaders.length + 1;
      const startCol = colIndexToLetter(startIdx);
      await writeHeaders(sheets, 'LEADS', startCol, newCols);
      console.log(`  ✅ Kolom ${newCols.join(', ')} ditambah mulai ${startCol}`);
    } else {
      console.log('  ⏭  FU_Tanggal & FU_Keterangan sudah ada, skip');
    }
  }

  // ─────────────────────────────────────────────
  // 3. RENTAL_STATUS → tambah N-S
  // ─────────────────────────────────────────────
  console.log('📋 RENTAL_STATUS...');
  const rentalHeaders = await getSheetHeaders(sheets, 'RENTAL_STATUS');
  if (rentalHeaders) {
    const newRentalCols = [
      'Agen_Listing_ID', 'Agen_Listing_Nama',
      'Agen_Selling_ID', 'Agen_Selling_Nama',
      'CoBroke', 'Hasil_FU_Reminder',
    ].filter(c => !rentalHeaders.includes(c));

    if (newRentalCols.length > 0) {
      const startIdx = rentalHeaders.length + 1;
      const startCol = colIndexToLetter(startIdx);
      await writeHeaders(sheets, 'RENTAL_STATUS', startCol, newRentalCols);
      console.log(`  ✅ Kolom ${newRentalCols.join(', ')} ditambah mulai ${startCol}`);
    } else {
      console.log('  ⏭  Semua kolom rental sudah ada, skip');
    }
  }

  // ─────────────────────────────────────────────
  // 4. PAYMENT_STAGES → buat tab baru jika belum ada
  // ─────────────────────────────────────────────
  console.log('📋 PAYMENT_STAGES...');
  const payHeaders = await getSheetHeaders(sheets, 'PAYMENT_STAGES');
  if (payHeaders === null) {
    await createSheet(sheets, 'PAYMENT_STAGES', [
      'ID', 'Lead_ID', 'Listing_ID', 'Tanggal', 'Catatan', 'Updated_By', 'Created_At',
    ]);
  } else {
    console.log('  ⏭  Tab PAYMENT_STAGES sudah ada, skip');
  }

  console.log('\n✅ Migration selesai!');
}

run().catch(err => {
  console.error('❌ Migration gagal:', err.message);
  process.exit(1);
});
