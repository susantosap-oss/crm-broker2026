/**
 * DuplicateService
 * ============================================
 * Deteksi listing kembar menggunakan Weighted Scoring System.
 *
 * Threshold: 80 poin → trigger modal konfirmasi di frontend.
 *
 * Scoring:
 *   Kecamatan + Kota  : 15 pts  (Exact Match — dipakai sebagai filter Step 1)
 *   Alamat (Fuzzy)    : 40 pts  (Levenshtein similarity × 40)
 *   Luas Tanah + LB   : 25 pts  (±5% → 12.5 per dimensi)
 *   Harga             : 10 pts  (±10%)
 *   Kamar Tidur       : 10 pts  (Exact Match)
 *   ─────────────────────────────────────────
 *   Total Maksimal    : 100 pts
 *
 * Algoritma (3-Step Narrowing):
 *   Step 1: Filter Kecamatan + Kota (Exact, case-insensitive)
 *   Step 2: Filter LT ±5% DAN LB ±5%
 *   Step 3: Hitung score lengkap (Levenshtein + harga + KT)
 */

const levenshtein = require('fast-levenshtein');
const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const THRESHOLD   = 80;
const LT_LB_TOL   = 0.05; // ±5%
const HARGA_TOL   = 0.10; // ±10%
const STEP2_RANGE = 0.20; // pre-filter lebih longgar sebelum scoring ketat

// ── Normalisasi Alamat ─────────────────────────────────────────────────────
const SINGKATAN = {
  'jl\\.?': 'jalan',
  'jln\\.?': 'jalan',
  'no\\.?': 'nomor',
  'gg\\.?': 'gang',
  'kav\\.?': 'kavling',
  'blk\\.?': 'blok',
  'rt\\.?': 'rt',
  'rw\\.?': 'rw',
  'kel\\.?': 'kelurahan',
  'kec\\.?': 'kecamatan',
  'kab\\.?': 'kabupaten',
  'dr\\.?': 'dr',
  'h\\.?': 'h',
};

function normalizeAlamat(str) {
  if (!str) return '';
  let s = str.toLowerCase().trim();
  // Hapus tanda baca kecuali spasi dan angka
  s = s.replace(/[^\w\s]/g, ' ');
  // Expand singkatan
  for (const [pattern, replacement] of Object.entries(SINGKATAN)) {
    s = s.replace(new RegExp(`\\b${pattern}\\b`, 'gi'), replacement);
  }
  // Trim spasi ganda
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ── Levenshtein Similarity (0–1) ───────────────────────────────────────────
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const na = normalizeAlamat(a);
  const nb = normalizeAlamat(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein.get(na, nb);
  return 1 - dist / maxLen;
}

// ── Cek toleransi range numerik ───────────────────────────────────────────
function inRange(val, target, tol) {
  if (!val || !target) return false;
  const v = parseFloat(val);
  const t = parseFloat(target);
  if (isNaN(v) || isNaN(t) || t === 0) return false;
  return Math.abs(v - t) / t <= tol;
}

// ── Hitung Score untuk satu kandidat ──────────────────────────────────────
function calcScore(candidate, payload) {
  let score = 0;
  const breakdown = { lokasi: 0, alamat: 0, lt_lb: 0, harga: 0, kt: 0 };

  // Kecamatan + Kota: 15 pts (sudah pasti match karena lolos Step 1)
  const samKec  = candidate.Kecamatan?.toLowerCase() === payload.Kecamatan?.toLowerCase();
  const samKota = candidate.Kota?.toLowerCase() === payload.Kota?.toLowerCase();
  if (samKec && samKota) {
    breakdown.lokasi = 15;
    score += 15;
  }

  // Alamat fuzzy: 40 pts
  const sim = similarity(candidate.Alamat, payload.Alamat);
  breakdown.alamat = Math.round(sim * 40);
  score += breakdown.alamat;

  // Luas Tanah: 12.5 pts
  if (inRange(candidate.Luas_Tanah, payload.Luas_Tanah, LT_LB_TOL)) {
    breakdown.lt_lb += 12.5;
    score += 12.5;
  }
  // Luas Bangunan: 12.5 pts
  if (inRange(candidate.Luas_Bangunan, payload.Luas_Bangunan, LT_LB_TOL)) {
    breakdown.lt_lb += 12.5;
    score += 12.5;
  }

  // Harga: 10 pts
  if (inRange(candidate.Harga, payload.Harga, HARGA_TOL)) {
    breakdown.harga = 10;
    score += 10;
  }

  // Kamar Tidur: 10 pts
  if (candidate.Kamar_Tidur && payload.Kamar_Tidur &&
      String(candidate.Kamar_Tidur).trim() === String(payload.Kamar_Tidur).trim()) {
    breakdown.kt = 10;
    score += 10;
  }

  return { score: Math.round(score), breakdown };
}

class DuplicateService {
  /**
   * Cek apakah payload listing baru mirip dengan listing existing.
   * @param {Object} payload  - Data listing yang akan dibuat (dari form agen)
   * @param {string} agenId   - ID agen yang sedang input (exclude listing sendiri saat update)
   * @returns {Array}         - Array kandidat duplikat dengan score ≥ THRESHOLD
   */
  async check(payload, agenId = null) {
    const { Kecamatan, Kota, Luas_Tanah, Luas_Bangunan } = payload;

    // Minimal butuh Kecamatan + Kota untuk Step 1
    if (!Kecamatan || !Kota) return [];

    // Load semua listing dari Sheets
    const rows = await sheetsService.getRange(SHEETS.LISTING);
    if (!rows || rows.length <= 1) return [];
    const [, ...data] = rows;
    const allListings = data.map(row =>
      COLUMNS.LISTING.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {})
    );

    // ── Step 1: Filter Kecamatan + Kota (case-insensitive exact match) ──────
    const step1 = allListings.filter(l =>
      l.Status_Listing === 'Aktif' &&
      l.Kecamatan?.toLowerCase() === Kecamatan?.toLowerCase() &&
      l.Kota?.toLowerCase() === Kota?.toLowerCase()
    );
    if (!step1.length) return [];

    // ── Step 2: Filter LT & LB dalam range STEP2_RANGE (pre-filter longgar) ─
    const step2 = step1.filter(l => {
      // Jika tidak ada LT/LB di payload → skip filter ini, langsung ke step 3
      if (!Luas_Tanah && !Luas_Bangunan) return true;
      const ltOk = !Luas_Tanah  || inRange(l.Luas_Tanah,    Luas_Tanah,    STEP2_RANGE);
      const lbOk = !Luas_Bangunan || inRange(l.Luas_Bangunan, Luas_Bangunan, STEP2_RANGE);
      return ltOk && lbOk;
    });
    if (!step2.length) return [];

    // ── Step 3: Hitung score lengkap untuk setiap kandidat ──────────────────
    const results = [];
    for (const candidate of step2) {
      // Skip listing milik agen sendiri (saat update / re-check)
      if (agenId && candidate.Agen_ID === agenId) continue;

      const { score, breakdown } = calcScore(candidate, payload);
      if (score >= THRESHOLD) {
        results.push({
          id:          candidate.ID,
          kode:        candidate.Kode_Listing,
          judul:       candidate.Judul,
          score,
          breakdown,
          alamat:      candidate.Alamat,
          kecamatan:   candidate.Kecamatan,
          kota:        candidate.Kota,
          harga_format: candidate.Harga_Format || candidate.Harga,
          luas_tanah:  candidate.Luas_Tanah,
          luas_bangunan: candidate.Luas_Bangunan,
          kamar_tidur: candidate.Kamar_Tidur,
          foto_utama:  candidate.Foto_Utama_URL,
          agen_id:     candidate.Agen_ID,
          agen_nama:   candidate.Agen_Nama,
          status:      candidate.Status_Listing,
          tipe:        candidate.Tipe_Properti,
        });
      }
    }

    // Sort: score tertinggi dulu
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Cari semua listing yang punya potensial kembar (untuk audit admin/principal).
   * @returns {Array} - Cluster listing yang diduga kembar
   */
  async findAllDuplicateClusters() {
    const rows = await sheetsService.getRange(SHEETS.LISTING);
    if (!rows || rows.length <= 1) return [];
    const [, ...data] = rows;
    const listings = data
      .map(row => COLUMNS.LISTING.reduce((obj, col, i) => { obj[col] = row[i] || ''; return obj; }, {}))
      .filter(l => l.Status_Listing === 'Aktif');

    const visited  = new Set();
    const clusters = [];

    for (let i = 0; i < listings.length; i++) {
      if (visited.has(listings[i].ID)) continue;

      const cluster = [listings[i]];
      visited.add(listings[i].ID);

      for (let j = i + 1; j < listings.length; j++) {
        if (visited.has(listings[j].ID)) continue;
        // Quick pre-filter: harus kecamatan + kota sama
        if (listings[j].Kecamatan?.toLowerCase() !== listings[i].Kecamatan?.toLowerCase()) continue;
        if (listings[j].Kota?.toLowerCase()       !== listings[i].Kota?.toLowerCase()) continue;

        const { score } = calcScore(listings[j], listings[i]);
        if (score >= THRESHOLD) {
          cluster.push({ ...listings[j], score });
          visited.add(listings[j].ID);
        }
      }

      if (cluster.length > 1) {
        clusters.push({
          cluster_id:  listings[i].ID,
          count:       cluster.length,
          kecamatan:   listings[i].Kecamatan,
          kota:        listings[i].Kota,
          items:       cluster.map(l => ({
            id:        l.ID,
            kode:      l.Kode_Listing,
            judul:     l.Judul,
            agen_id:   l.Agen_ID,
            agen_nama: l.Agen_Nama,
            score:     l.score || 100, // referensi item pertama = 100
            foto:      l.Foto_Utama_URL,
            harga:     l.Harga_Format || l.Harga,
          })),
        });
      }
    }

    return clusters;
  }
}

module.exports = new DuplicateService();
