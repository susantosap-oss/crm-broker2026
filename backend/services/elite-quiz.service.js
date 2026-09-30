/**
 * Elite Qualification Test (EQT) Service
 * Menyimpan & membaca hasil ujian dari sheet ELITE_QUIZ_RESULTS,
 * lalu mengupdate EQT_Nilai + EQT_Verified di ELITE_PROGRAM jika lulus.
 */

const { v4: uuidv4 } = require('uuid');
const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...dataRows] = rows;
  return dataRows.map((row, idx) => {
    const obj = { _rowIdx: idx + 2 };
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// ── Submit ──────────────────────────────────────────────────

async function submitQuiz({ nilai, persen, status, waktuDetik, jawabanJson }, user) {
  const now = new Date().toISOString();

  // Hitung attempt ke-N untuk agen ini
  const existing = rowsToObjects(await sheetsService.getRange(SHEETS.ELITE_QUIZ_RESULTS));
  const attempt = existing.filter(r => r.Agent_ID === user.id).length + 1;

  const row = {
    ID:          uuidv4(),
    Agent_ID:    user.id,
    Agen_Nama:   user.nama || '',
    Nama_Kantor: user.nama_kantor || '',
    Tanggal:     now,
    Nilai:       String(nilai),
    Persen:      String(persen),
    Status:      status,
    Waktu_Detik: String(waktuDetik || 0),
    Attempt_Ke:  String(attempt),
    Jawaban_JSON: typeof jawabanJson === 'string' ? jawabanJson : JSON.stringify(jawabanJson || {}),
  };

  await sheetsService.appendRow(SHEETS.ELITE_QUIZ_RESULTS, COLUMNS.ELITE_QUIZ_RESULTS.map(c => row[c] || ''));

  // Auto-sync EQT_Nilai (dari Persen) + EQT_Verified (dari Status) di ELITE_PROGRAM
  await _updateEliteEQT(user.id, persen, status, now);

  return { ...row, attempt };
}

// Sync EQT_Nilai (dari Persen) + EQT_Verified (dari Status: Lulus=TRUE, selain itu FALSE)
// ke draft/aktif ELITE_PROGRAM milik agen. No-op kalau tidak ada program atau nilai sudah sama.
async function _updateEliteEQT(agentId, persen, status, now) {
  try {
    const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
    const objs = rowsToObjects(rows);
    const program = objs.find(p => p.Agent_ID === agentId && ['Draft', 'Aktif'].includes(p.Status));
    if (!program) return false;

    const nilaiBaru    = String(persen ?? '');
    const verifiedBaru = status === 'Lulus' ? 'TRUE' : 'FALSE';
    if (program.EQT_Nilai === nilaiBaru && program.EQT_Verified === verifiedBaru) return false;

    program.EQT_Nilai    = nilaiBaru;
    program.EQT_Verified = verifiedBaru;
    program.EQT_Tgl      = now.slice(0, 10);
    program.Diperbarui_Pada = now;

    await sheetsService.updateRow(
      SHEETS.ELITE_PROGRAM,
      program._rowIdx,
      COLUMNS.ELITE_PROGRAM.map(c => program[c] || '')
    );
    return true;
  } catch (e) {
    console.error('[EQT] update ELITE_PROGRAM error:', e.message);
    return false;
  }
}

// Self-heal: sinkronkan attempt TERBARU tiap agen (di ELITE_QUIZ_RESULTS) ke ELITE_PROGRAM.
// Menangani hasil quiz yang masuk sebelum auto-sync ini ada / sempat gagal. Idempotent.
async function backfillEQTSync() {
  const results = rowsToObjects(await sheetsService.getRange(SHEETS.ELITE_QUIZ_RESULTS));
  const latestByAgent = {};
  for (const r of results) {
    if (!r.Agent_ID) continue;
    const prev = latestByAgent[r.Agent_ID];
    if (!prev || new Date(r.Tanggal) > new Date(prev.Tanggal)) latestByAgent[r.Agent_ID] = r;
  }

  const synced = [];
  for (const r of Object.values(latestByAgent)) {
    try {
      const changed = await _updateEliteEQT(r.Agent_ID, r.Persen, r.Status, new Date().toISOString());
      if (changed) synced.push({ agentId: r.Agent_ID, nama: r.Agen_Nama });
    } catch (e) {
      console.warn('[EQT] backfill gagal untuk', r.Agent_ID, e.message);
    }
  }
  return synced;
}

// ── Queries ─────────────────────────────────────────────────

async function getMyResults(agentId) {
  const rows = rowsToObjects(await sheetsService.getRange(SHEETS.ELITE_QUIZ_RESULTS));
  return rows
    .filter(r => r.Agent_ID === agentId)
    .sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
}

async function getAllResults() {
  const rows = rowsToObjects(await sheetsService.getRange(SHEETS.ELITE_QUIZ_RESULTS));
  return rows.sort((a, b) => new Date(b.Tanggal) - new Date(a.Tanggal));
}

// Ringkasan per agen: attempt total, nilai tertinggi, terakhir submit
async function getSummaryByAgent() {
  const rows = rowsToObjects(await sheetsService.getRange(SHEETS.ELITE_QUIZ_RESULTS));
  const map = {};
  for (const r of rows) {
    if (!map[r.Agent_ID]) {
      map[r.Agent_ID] = {
        Agent_ID:    r.Agent_ID,
        Agen_Nama:   r.Agen_Nama,
        Nama_Kantor: r.Nama_Kantor,
        total_attempt: 0,
        nilai_tertinggi: 0,
        terakhir_submit: '',
        terakhir_status: '',
      };
    }
    const s = map[r.Agent_ID];
    s.total_attempt++;
    const n = parseInt(r.Nilai) || 0;
    if (n > s.nilai_tertinggi) {
      s.nilai_tertinggi = n;
      s.terakhir_status = r.Status;
    }
    if (!s.terakhir_submit || r.Tanggal > s.terakhir_submit) {
      s.terakhir_submit = r.Tanggal;
    }
  }
  return Object.values(map);
}

module.exports = { submitQuiz, getMyResults, getAllResults, getSummaryByAgent, backfillEQTSync };
