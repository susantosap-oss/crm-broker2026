/**
 * Elite Partner Service
 * Business logic for ELITE Partner System
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const sheetsService = require('./sheets.service');
const { SHEETS, COLUMNS } = require('../config/sheets.config');

const EVALUASI_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...dataRows] = rows;
  return dataRows.map((row, idx) => {
    const obj = { _rowIdx: idx + 2 };
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// Normalisasi No_WA ke bentuk tanpa prefix "0"/"62" agar format berbeda
// (mis. dengan kode negara vs tanpa) tetap bisa dicocokkan.
function normalizePhoneTail(v) {
  let s = String(v || '').replace(/\D/g, '');
  if (s.startsWith('62')) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  return s;
}

// Cari akun AGENTS yang No_WA-nya cocok (setelah normalisasi) dengan noWa.
async function findAgentByPhone(noWa) {
  const tail = normalizePhoneTail(noWa);
  if (!tail) return null;
  const rows = await sheetsService.getRange(SHEETS.AGENTS);
  const agents = rowsToObjects(rows);
  return agents.find(a => a.No_WA && normalizePhoneTail(a.No_WA) === tail) || null;
}

function toRow(obj, cols) {
  return cols.map(c => obj[c] !== undefined ? obj[c] : '');
}

async function sendWA(target, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token || !target) return;
  try {
    await axios.post('https://api.fonnte.com/send', { target, message }, {
      headers: { Authorization: token },
      timeout: 10000,
    });
  } catch (e) {
    console.error('[ELITE] WA send error:', e.message);
  }
}

async function getPrincipalsWA() {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const objs = rowsToObjects(rows);
    return objs
      .filter(a => ['principal','kantor','superadmin'].includes(a.Role) && a.Status !== 'Nonaktif' && a.No_WA)
      .map(a => a.No_WA);
  } catch { return []; }
}

async function getAgentById(agentId) {
  const rows = await sheetsService.getRange(SHEETS.AGENTS);
  const objs = rowsToObjects(rows);
  return objs.find(a => a.ID === agentId) || null;
}

async function updateAgentEliteFields(agentId, splitKomisi, statusElite) {
  const rows = await sheetsService.getRange(SHEETS.AGENTS);
  const objs = rowsToObjects(rows);
  const agent = objs.find(a => a.ID === agentId);
  if (!agent) throw new Error('Agen tidak ditemukan');
  agent.Split_Komisi = splitKomisi;
  agent.Status_Elite = statusElite;
  agent.Updated_At = new Date().toISOString();
  await sheetsService.updateRow(SHEETS.AGENTS, agent._rowIdx, COLUMNS.AGENTS.map(c => agent[c] || ''));
  return agent;
}

// ── Program CRUD ──────────────────────────────────────────

async function listElitePrograms() {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  return rowsToObjects(rows);
}

async function getProgramByAgent(agentId) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  return objs.find(p => p.Agent_ID === agentId && ['Draft','Aktif','Evaluasi'].includes(p.Status)) || null;
}

async function getProgramById(programId) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  return objs.find(p => p.ID === programId) || null;
}

async function saveChecklist(data, createdBy) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const existing = objs.find(p => p.Agent_ID === data.agentId && ['Draft','Aktif'].includes(p.Status));

  const now = new Date().toISOString();
  if (existing) {
    existing.Form_E1_Verified       = data.formE1Verified       || existing.Form_E1_Verified;
    existing.Form_E1_Catatan        = data.formE1Catatan        !== undefined ? data.formE1Catatan        : existing.Form_E1_Catatan;
    existing.Form_E1_Tgl            = data.formE1Verified === 'TRUE' ? now.slice(0,10) : existing.Form_E1_Tgl;
    existing.EQT_Nilai              = data.eqtNilai              !== undefined ? data.eqtNilai              : existing.EQT_Nilai;
    existing.EQT_Verified           = data.eqtVerified           || existing.EQT_Verified;
    existing.EQT_Tgl                = data.eqtVerified === 'TRUE' ? now.slice(0,10) : existing.EQT_Tgl;
    existing.Kontrak_Verified       = data.kontrakVerified       || existing.Kontrak_Verified;
    existing.Kontrak_Tgl            = data.kontrakVerified === 'TRUE' ? now.slice(0,10) : existing.Kontrak_Tgl;
    existing.Target_Kuartal_Nilai   = data.targetKuartalNilai   !== undefined ? data.targetKuartalNilai   : existing.Target_Kuartal_Nilai;
    existing.Target_Kuartal_Verified= data.targetKuartalVerified|| existing.Target_Kuartal_Verified;
    existing.Target_Kuartal_Tgl     = data.targetKuartalVerified === 'TRUE' ? now.slice(0,10) : existing.Target_Kuartal_Tgl;
    existing.Diperbarui_Pada        = now;
    await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, existing._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => existing[c] || ''));
    return existing;
  }

  const agent = await getAgentById(data.agentId);
  const program = {
    ID: uuidv4(),
    Agent_ID: data.agentId,
    Agen_Nama: data.agenNama || agent?.Nama || '',
    Nama_Kantor: data.namaKantor || agent?.Nama_Kantor || '',
    Tanggal_Mulai: '',
    Tanggal_Berakhir: '',
    Status: 'Draft',
    Form_E1_Verified: data.formE1Verified || 'FALSE',
    Form_E1_Catatan: data.formE1Catatan || '',
    Form_E1_Tgl: data.formE1Verified === 'TRUE' ? now.slice(0,10) : '',
    EQT_Nilai: data.eqtNilai || '',
    EQT_Verified: data.eqtVerified || 'FALSE',
    EQT_Tgl: data.eqtVerified === 'TRUE' ? now.slice(0,10) : '',
    Kontrak_Verified: data.kontrakVerified || 'FALSE',
    Kontrak_Tgl: data.kontrakVerified === 'TRUE' ? now.slice(0,10) : '',
    Target_Kuartal_Nilai: data.targetKuartalNilai || '',
    Target_Kuartal_Verified: data.targetKuartalVerified || 'FALSE',
    Target_Kuartal_Tgl: data.targetKuartalVerified === 'TRUE' ? now.slice(0,10) : '',
    Split_Sebelumnya: '',
    Alasan_NonAktif: '',
    Notif_60_Terkirim: 'FALSE',
    Dibuat_Oleh: createdBy,
    Dibuat_Pada: now,
    Diperbarui_Pada: now,
    Evaluasi_Sejak: '',
    Notif_Eval_Terkirim: 'FALSE',
  };
  await sheetsService.appendRow(SHEETS.ELITE_PROGRAM, COLUMNS.ELITE_PROGRAM.map(c => program[c] || ''));
  return program;
}

async function activateElite(agentId, activatedBy) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const program = objs.find(p => p.Agent_ID === agentId && ['Draft','Aktif'].includes(p.Status));
  if (!program) throw new Error('Program Draft tidak ditemukan untuk agen ini');

  const allVerified = program.Form_E1_Verified === 'TRUE'
    && program.EQT_Verified === 'TRUE'
    && program.Kontrak_Verified === 'TRUE'
    && program.Target_Kuartal_Verified === 'TRUE';
  if (!allVerified) throw new Error('Semua 4 checklist harus diverifikasi sebelum aktivasi');

  const agent = await getAgentById(agentId);
  if (!agent) throw new Error('Agen tidak ditemukan');

  const now = new Date();
  const tanggalMulai = now.toISOString().slice(0,10);
  const tanggalBerakhir = new Date(now.getTime() + 365*24*60*60*1000).toISOString().slice(0,10);

  program.Split_Sebelumnya = agent.Split_Komisi || '';
  program.Status = 'Aktif';
  program.Tanggal_Mulai = tanggalMulai;
  program.Tanggal_Berakhir = tanggalBerakhir;
  program.Diperbarui_Pada = now.toISOString();
  await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, program._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => program[c] || ''));

  await updateAgentEliteFields(agentId, '70', 'ELITE');

  const msg = `✅ *ELITE Partner Aktif!*\n\nHalo ${agent.Nama}, selamat! Anda resmi menjadi ELITE Partner Mansion.\n\n📅 Berlaku: ${tanggalMulai} s/d ${tanggalBerakhir}\n💰 Split Komisi: 70%\n\nTetap semangat dan raih target Anda!`;
  if (agent.No_WA) await sendWA(agent.No_WA, msg);

  const adminMsg = `🏆 *ELITE Partner Baru!*\n\n${agent.Nama} (${agent.Nama_Kantor}) resmi menjadi ELITE Partner.\n📅 Berlaku: ${tanggalMulai} s/d ${tanggalBerakhir}\n\nDiaktifkan oleh: ${activatedBy}`;
  const principalWAs = await getPrincipalsWA();
  for (const wa of principalWAs) await sendWA(wa, adminMsg);

  return program;
}

async function terminateProgram(programId, reason, terminatedBy) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const program = objs.find(p => p.ID === programId);
  if (!program) throw new Error('Program tidak ditemukan');
  if (!['Aktif','Evaluasi'].includes(program.Status)) throw new Error('Program tidak sedang Aktif atau Evaluasi');

  program.Status = 'Gugur_Manual';
  program.Alasan_NonAktif = reason || '';
  program.Diperbarui_Pada = new Date().toISOString();
  await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, program._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => program[c] || ''));

  await updateAgentEliteFields(program.Agent_ID, program.Split_Sebelumnya || '', '');

  const agent = await getAgentById(program.Agent_ID);
  const msg = `⚠️ *Status ELITE Dihentikan*\n\nHalo ${agent?.Nama || program.Agen_Nama}, status ELITE Partner Anda telah dihentikan.\n\nAlasan: ${reason || '-'}\n\nHubungi kantor untuk informasi lebih lanjut.`;
  if (agent?.No_WA) await sendWA(agent.No_WA, msg);

  const adminMsg = `⚠️ *ELITE Partner Dihentikan*\n\n${program.Agen_Nama} (${program.Nama_Kantor})\nAlasan: ${reason || '-'}\nOleh: ${terminatedBy}`;
  const principalWAs = await getPrincipalsWA();
  for (const wa of principalWAs) await sendWA(wa, adminMsg);

  return program;
}

// ── Content CRUD ──────────────────────────────────────────

async function getContent() {
  const rows = await sheetsService.getRange(SHEETS.ELITE_CONTENT);
  if (!rows || rows.length < 2) return { Penjelasan_Program: '', Ketentuan_Program: '', Cara_Daftar: '' };
  const [headers, dataRow] = rows;
  const obj = {};
  headers.forEach((h, i) => { obj[h] = dataRow[i] || ''; });
  return obj;
}

async function updateContent(data, updatedBy) {
  const now = new Date().toISOString();
  const vals = COLUMNS.ELITE_CONTENT.map(c => {
    if (c === 'Penjelasan_Program') return data.penjelasanProgram || '';
    if (c === 'Ketentuan_Program') return data.ketentuanProgram || '';
    if (c === 'Cara_Daftar') return data.caraDaftar || '';
    if (c === 'Updated_By') return updatedBy;
    if (c === 'Updated_At') return now;
    return '';
  });
  const rows = await sheetsService.getRange(SHEETS.ELITE_CONTENT);
  if (rows && rows.length >= 2) {
    await sheetsService.updateRow(SHEETS.ELITE_CONTENT, 2, vals);
  } else {
    await sheetsService.appendRow(SHEETS.ELITE_CONTENT, vals);
  }
  sheetsService.clearCache(SHEETS.ELITE_CONTENT);
}

// ── Transactions CRUD ─────────────────────────────────────

function formatTrxId(count) {
  return 'ELTRX-' + String(count).padStart(4, '0');
}

async function getTransactionsByAgent(agentId) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
  const objs = rowsToObjects(rows);
  return objs.filter(t => t.Agent_ID === agentId);
}

async function addTransaction(data, user) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
  const count = rows ? rows.length : 1;
  const now = new Date().toISOString();

  const nilaiTrx = parseFloat(data.nilaiTransaksi) || 0;
  const komisiPersen = parseFloat(data.komisiPersen) || 0;
  const nilaiKomisi = nilaiTrx * (komisiPersen / 100);
  const coBroke = data.coBroke === true || data.coBroke === 'TRUE';
  const nilaiEfektif = coBroke ? nilaiTrx * 0.5 : nilaiTrx;
  const bulan = (data.tanggal || now.slice(0,10)).slice(0,7);

  const program = await getProgramByAgent(user.id);

  const trx = {
    ID: formatTrxId(count),
    Elite_Program_ID: program?.ID || '',
    Agent_ID: user.id,
    Agen_Nama: user.nama || '',
    Tanggal: data.tanggal || now.slice(0,10),
    Bulan: bulan,
    Alamat_Transaksi: data.alamatTransaksi || '',
    Tipe: data.tipe || 'Jual',
    Co_Broke: coBroke ? 'TRUE' : 'FALSE',
    Nilai_Transaksi: nilaiTrx,
    Komisi_Persen: komisiPersen,
    Nilai_Komisi: nilaiKomisi,
    Nilai_Efektif: nilaiEfektif,
    Dibuat_Pada: now,
    Diperbarui_Pada: now,
  };
  await sheetsService.appendRow(SHEETS.ELITE_TRANSACTIONS, COLUMNS.ELITE_TRANSACTIONS.map(c => trx[c] !== undefined ? trx[c] : ''));
  return trx;
}

async function updateTransaction(id, data, userId) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
  const objs = rowsToObjects(rows);
  const trx = objs.find(t => t.ID === id);
  if (!trx) throw new Error('Transaksi tidak ditemukan');
  if (trx.Agent_ID !== userId) throw new Error('Bukan transaksi Anda');

  const nilaiTrx = parseFloat(data.nilaiTransaksi !== undefined ? data.nilaiTransaksi : trx.Nilai_Transaksi) || 0;
  const komisiPersen = parseFloat(data.komisiPersen !== undefined ? data.komisiPersen : trx.Komisi_Persen) || 0;
  const nilaiKomisi = nilaiTrx * (komisiPersen / 100);
  const coBroke = data.coBroke !== undefined ? (data.coBroke === true || data.coBroke === 'TRUE') : trx.Co_Broke === 'TRUE';
  const nilaiEfektif = coBroke ? nilaiTrx * 0.5 : nilaiTrx;

  trx.Tanggal = data.tanggal || trx.Tanggal;
  trx.Bulan = (data.tanggal || trx.Tanggal).slice(0,7);
  trx.Alamat_Transaksi = data.alamatTransaksi !== undefined ? data.alamatTransaksi : trx.Alamat_Transaksi;
  trx.Tipe = data.tipe || trx.Tipe;
  trx.Co_Broke = coBroke ? 'TRUE' : 'FALSE';
  trx.Nilai_Transaksi = nilaiTrx;
  trx.Komisi_Persen = komisiPersen;
  trx.Nilai_Komisi = nilaiKomisi;
  trx.Nilai_Efektif = nilaiEfektif;
  trx.Diperbarui_Pada = new Date().toISOString();

  await sheetsService.updateRow(SHEETS.ELITE_TRANSACTIONS, trx._rowIdx, COLUMNS.ELITE_TRANSACTIONS.map(c => trx[c] !== undefined ? trx[c] : ''));
  return trx;
}

async function deleteTransaction(id, userId, isAdmin) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
  const objs = rowsToObjects(rows);
  const trx = objs.find(t => t.ID === id);
  if (!trx) throw new Error('Transaksi tidak ditemukan');
  if (!isAdmin && trx.Agent_ID !== userId) throw new Error('Bukan transaksi Anda');
  await sheetsService.deleteRow(SHEETS.ELITE_TRANSACTIONS, trx._rowIdx);
}

// ── Helpers: quarterly eval dates ────────────────────────

function getNextEvalDate(startDate, today) {
  for (const q of [1, 2, 3, 4]) {
    const evalDate = new Date(startDate);
    evalDate.setMonth(evalDate.getMonth() + q * 3);
    evalDate.setHours(0, 0, 0, 0);
    if (evalDate > today) return { evalDate, quarterNum: q };
  }
  return null;
}

// ── Scheduler: Expiry + 60-day notif + Evaluasi grace + pre-eval warning ──

async function runEliteCheck() {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results = [];

  // Lazy-load transaksi hanya jika ada program Aktif (untuk pre-eval progress)
  let allTrx = null;
  async function getTrx() {
    if (!allTrx) {
      const trxRows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
      allTrx = rowsToObjects(trxRows);
    }
    return allTrx;
  }

  for (const p of objs) {
    // ── Evaluasi grace period: 14 hari sejak Evaluasi_Sejak → Gugur_Kinerja ──
    if (p.Status === 'Evaluasi' && p.Evaluasi_Sejak) {
      const sinceDate = new Date(p.Evaluasi_Sejak);
      sinceDate.setHours(0, 0, 0, 0);
      const sinceDays = Math.floor((today - sinceDate) / DAY_MS);
      if (sinceDays >= EVALUASI_GRACE_DAYS) {
        p.Status = 'Gugur_Kinerja';
        p.Alasan_NonAktif = (p.Alasan_NonAktif || '') + ` | Grace period ${EVALUASI_GRACE_DAYS} hari habis tanpa klarifikasi.`;
        p.Diperbarui_Pada = new Date().toISOString();
        await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
        await updateAgentEliteFields(p.Agent_ID, p.Split_Sebelumnya || '', '');
        const agent = await getAgentById(p.Agent_ID);
        const msg = `🚫 *ELITE Partner: Status Gugur*\n\nHalo ${p.Agen_Nama}, masa klarifikasi evaluasi kinerja (${EVALUASI_GRACE_DAYS} hari) telah berakhir.\n\nStatus ELITE dihentikan. Hubungi kantor untuk informasi lebih lanjut.`;
        if (agent?.No_WA) await sendWA(agent.No_WA, msg);
        const adminMsg = `🚫 ELITE Gugur Kinerja (grace habis): ${p.Agen_Nama} (${p.Nama_Kantor}) — evaluasi sejak ${p.Evaluasi_Sejak}`;
        const principalWAs = await getPrincipalsWA();
        for (const wa of principalWAs) await sendWA(wa, adminMsg);
        results.push({ id: p.ID, action: 'gugur_kinerja_grace', agent: p.Agen_Nama });
      }
      continue;
    }

    if (p.Status !== 'Aktif') continue;

    const start = new Date(p.Tanggal_Mulai);
    const end   = new Date(p.Tanggal_Berakhir);
    if (isNaN(end.getTime())) continue;

    const diffMs   = end - today;
    const diffDays = Math.floor(diffMs / DAY_MS);

    // ── 60-day expiry warning ─────────────────────────────
    if (diffDays <= 60 && p.Notif_60_Terkirim !== 'TRUE') {
      const agent = await getAgentById(p.Agent_ID);
      const msg = `⏰ *Notifikasi ELITE Partner*\n\nHalo ${p.Agen_Nama}, status ELITE Partner Anda akan berakhir dalam ${diffDays} hari (${p.Tanggal_Berakhir}).\n\nHubungi kantor untuk perpanjangan.`;
      if (agent?.No_WA) await sendWA(agent.No_WA, msg);
      const adminMsg = `⏰ ${p.Agen_Nama}: ELITE akan berakhir ${diffDays} hari lagi (${p.Tanggal_Berakhir})`;
      const principalWAs = await getPrincipalsWA();
      for (const wa of principalWAs) await sendWA(wa, adminMsg);
      p.Notif_60_Terkirim = 'TRUE';
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      results.push({ id: p.ID, action: 'notif_60', agent: p.Agen_Nama });
    }

    // ── Auto-expired ──────────────────────────────────────
    if (diffDays < 0) {
      p.Status = 'Gugur_Expired';
      p.Alasan_NonAktif = 'Otomatis expired';
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      await updateAgentEliteFields(p.Agent_ID, p.Split_Sebelumnya || '', '');
      const agent = await getAgentById(p.Agent_ID);
      const msg = `⚠️ *ELITE Partner Berakhir*\n\nHalo ${p.Agen_Nama}, status ELITE Partner Anda telah berakhir (${p.Tanggal_Berakhir}).\n\nHubungi kantor untuk informasi perpanjangan.`;
      if (agent?.No_WA) await sendWA(agent.No_WA, msg);
      const adminMsg = `⚠️ ELITE Expired: ${p.Agen_Nama} (${p.Nama_Kantor}) — ${p.Tanggal_Berakhir}`;
      const principalWAs = await getPrincipalsWA();
      for (const wa of principalWAs) await sendWA(wa, adminMsg);
      results.push({ id: p.ID, action: 'expired', agent: p.Agen_Nama });
      continue;
    }

    // ── Pre-eval H-7 warning ──────────────────────────────
    if (!isNaN(start.getTime()) && p.Notif_Eval_Terkirim !== 'TRUE') {
      const nextEval = getNextEvalDate(start, today);
      if (nextEval) {
        const daysToEval = Math.floor((nextEval.evalDate - today) / DAY_MS);
        if (daysToEval >= 0 && daysToEval <= 7) {
          const trx = await getTrx();
          const agentTrx = trx.filter(t => t.Agent_ID === p.Agent_ID);
          const startEval = new Date(today);
          startEval.setMonth(today.getMonth() - 3);
          const relevantTrx = agentTrx.filter(t => {
            const d = new Date(t.Tanggal);
            return d >= startEval && d <= today;
          });
          const totalEfektif = relevantTrx.reduce((sum, t) => sum + (parseFloat(t.Nilai_Efektif) || 0), 0);
          const target = parseFloat(p.Target_Kuartal_Nilai) || 0;
          const threshold = target * 0.8;
          const pct = target > 0 ? Math.round(totalEfektif / target * 100) : 0;

          const agent = await getAgentById(p.Agent_ID);
          const msg = `📊 *ELITE Partner: Peringatan Evaluasi Kinerja*\n\nHalo ${p.Agen_Nama}, evaluasi kinerja Q${nextEval.quarterNum} akan dilakukan dalam *${daysToEval} hari* (${nextEval.evalDate.toISOString().slice(0,10)}).\n\nProgress saat ini:\n💰 Total Efektif: Rp ${totalEfektif.toLocaleString('id-ID')}\n🎯 Target 80%: Rp ${threshold.toLocaleString('id-ID')}\n📈 Pencapaian: ${pct}%\n\n${pct >= 80 ? '✅ Anda sudah memenuhi target minimal!' : '⚠️ Masih di bawah target minimal. Segera kejar transaksi!'}\n\nHubungi kantor jika ada pertanyaan.`;
          if (agent?.No_WA) await sendWA(agent.No_WA, msg);
          const adminMsg = `📊 Pre-Eval Q${nextEval.quarterNum} — ${p.Agen_Nama}: ${pct}% target (Rp ${totalEfektif.toLocaleString('id-ID')} / min Rp ${threshold.toLocaleString('id-ID')}) — eval dalam ${daysToEval} hari`;
          const principalWAs = await getPrincipalsWA();
          for (const wa of principalWAs) await sendWA(wa, adminMsg);
          p.Notif_Eval_Terkirim = 'TRUE';
          p.Diperbarui_Pada = new Date().toISOString();
          await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
          results.push({ id: p.ID, action: 'notif_pre_eval', agent: p.Agen_Nama, quarterNum: nextEval.quarterNum, daysToEval, pct });
        }
      }
    }
  }
  return results;
}

// ── Scheduler: Quarterly Performance ─────────────────────

async function runEliteKinerja() {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const today = new Date();
  const results = [];

  for (const p of objs) {
    if (p.Status !== 'Aktif') continue;
    const start = new Date(p.Tanggal_Mulai);
    if (isNaN(start.getTime())) continue;

    const diffMonths = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    if (![3,6,9,12].includes(diffMonths)) continue;

    const trxRows = await sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS);
    const allTrx = rowsToObjects(trxRows);

    const agentTrx = allTrx.filter(t => t.Agent_ID === p.Agent_ID);
    const startEval = new Date(today);
    startEval.setMonth(today.getMonth() - 3);
    const relevantTrx = agentTrx.filter(t => {
      const d = new Date(t.Tanggal);
      return d >= startEval && d <= today;
    });
    const totalEfektif = relevantTrx.reduce((sum, t) => sum + (parseFloat(t.Nilai_Efektif) || 0), 0);
    const target = parseFloat(p.Target_Kuartal_Nilai) || 0;
    const threshold = target * 0.8;

    // Reset pre-eval warning flag agar kuartal berikutnya bisa kirim notif lagi
    p.Notif_Eval_Terkirim = 'FALSE';

    if (target > 0 && totalEfektif < threshold) {
      const now = new Date().toISOString();
      p.Status = 'Evaluasi';
      p.Evaluasi_Sejak = now.slice(0, 10);
      p.Alasan_NonAktif = `Kinerja Q${diffMonths/3}: Rp ${totalEfektif.toLocaleString('id-ID')} < 80% target Rp ${threshold.toLocaleString('id-ID')}`;
      p.Diperbarui_Pada = now;
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      const agent = await getAgentById(p.Agent_ID);
      const pct = Math.round(totalEfektif / target * 100);
      const msg = `⚠️ *ELITE Partner: Status EVALUASI*\n\nHalo ${p.Agen_Nama}, evaluasi kinerja Q${diffMonths/3} menunjukkan pencapaian di bawah 80% target.\n\nTotal Efektif: Rp ${totalEfektif.toLocaleString('id-ID')} (${pct}%)\nTarget minimal 80%: Rp ${threshold.toLocaleString('id-ID')}\n\n🕐 Status ELITE Anda berubah ke *EVALUASI*. Anda memiliki waktu *${EVALUASI_GRACE_DAYS} hari* untuk klarifikasi dengan kantor.\n\nSegera hubungi kantor untuk tindak lanjut.`;
      if (agent?.No_WA) await sendWA(agent.No_WA, msg);
      const adminMsg = `⚠️ ELITE EVALUASI Q${diffMonths/3}: ${p.Agen_Nama} (${p.Nama_Kantor}) — Efektif Rp ${totalEfektif.toLocaleString('id-ID')} (${pct}%) vs target 80% Rp ${threshold.toLocaleString('id-ID')} — grace ${EVALUASI_GRACE_DAYS} hari`;
      const principalWAs = await getPrincipalsWA();
      for (const wa of principalWAs) await sendWA(wa, adminMsg);
      results.push({ id: p.ID, action: 'evaluasi', agent: p.Agen_Nama, pct });
    } else {
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      results.push({ id: p.ID, action: 'kinerja_ok', agent: p.Agen_Nama, totalEfektif });
    }
  }
  return results;
}

// ── Scheduler: Sync ZKomisi → ELITE_TRANSACTIONS ─────────

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

function parseTanggalZKomisi(str) {
  if (!str) return new Date().toISOString().slice(0, 10);
  // DD/MM/YYYY dari Google Forms
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return str.slice(0, 10);
}

async function syncZKomisiElite() {
  const sheetId = process.env.KOMISI_GFORM_SHEET_ID || '193lcLmru7ghRSz-ChZz8sTA7sNTL35a6BYgriaomUU4';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Data_Masuk&range=A:Q`;

  const resp = await axios.get(url, {
    timeout: 15000, responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5,
  });

  const lines = (resp.data || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { synced: 0, skipped: 0, noAgent: 0, errors: [] };

  const header = parseCSVLine(lines[0]);
  const colIdx = {};
  header.forEach((h, i) => { colIdx[h.trim()] = i; });
  const col = (row, name) => (row[colIdx[name]] || '').trim();

  // Load semua data sekali (hindari N+1 calls ke Sheets)
  const [trxRows, agentRows, programRows] = await Promise.all([
    sheetsService.getRange(SHEETS.ELITE_TRANSACTIONS),
    sheetsService.getRange(SHEETS.AGENTS),
    sheetsService.getRange(SHEETS.ELITE_PROGRAM),
  ]);

  const existingTrx = rowsToObjects(trxRows);
  // Dedup key: "noTrx|agentId" — dua agen ELITE di transaksi yang sama tetap keduanya tersync
  const syncedKeys = new Set(
    existingTrx
      .filter(t => t.Ref_No_Transaksi)
      .map(t => `${t.Ref_No_Transaksi}|${t.Agent_ID || t.Agen_Nama}`)
  );
  let trxCount = trxRows ? trxRows.length : 1;

  const allAgents  = rowsToObjects(agentRows);
  const allPrograms = rowsToObjects(programRows);

  function findAgentByName(nama) {
    if (!nama) return null;
    const namaLower = nama.toLowerCase().trim();
    return allAgents.find(a => {
      const agNama = (a.Nama || '').toLowerCase();
      return agNama === namaLower ||
        agNama.includes(namaLower) ||
        namaLower.includes(agNama.split(' ')[0]);
    }) || null;
  }

  const results = { synced: 0, skipped: 0, noAgent: 0, errors: [] };

  const dataRows = lines.slice(1)
    .map(l => parseCSVLine(l))
    .filter(r => r.length >= 5 && r.some(c => c.trim()));

  for (const r of dataRows) {
    const noTrx      = col(r, 'Nomer Transaksi');
    const statusData = col(r, 'Status Data');

    if (statusData !== 'Ya' || !noTrx) { results.skipped++; continue; }

    const statusEliteListing = col(r, 'Status Agen Listing');
    const statusEliteSelling = col(r, 'Status Agen Selling');
    if (statusEliteListing !== 'ELITE' && statusEliteSelling !== 'ELITE') {
      results.skipped++; continue;
    }

    const namaListing = col(r, 'Nama Agen Listing');
    const namaSelling = col(r, 'Nama Agen Selling');
    const harga    = parseFloat(col(r, 'Harga Transaksi').replace(/[^\d.]/g, '')) || 0;
    const persen   = parseFloat(col(r, 'Prosentase Komisi')) || 0;
    const tanggal  = parseTanggalZKomisi(col(r, 'Tanggal Transaksi'));
    const alamat   = col(r, 'Alamat Transaksi');
    const tipe     = col(r, 'Jenis Transaksi').toLowerCase().includes('ewa') ? 'Sewa' : 'Jual';
    const coBroke  = !!(namaListing && namaSelling);

    const toSync = [];
    if (statusEliteListing === 'ELITE') toSync.push(namaListing);
    if (statusEliteSelling === 'ELITE') toSync.push(namaSelling);

    for (const nama of toSync) {
      try {
        const agent    = findAgentByName(nama);
        const agentId  = agent?.ID || '';
        const agenNama = agent?.Nama || nama;
        const dedupKey = `${noTrx}|${agentId || nama}`;

        if (syncedKeys.has(dedupKey)) continue;

        if (!agentId) results.noAgent++;

        const program = agentId
          ? allPrograms.find(p => p.Agent_ID === agentId && ['Aktif', 'Evaluasi'].includes(p.Status))
          : null;

        const nilaiKomisi  = Math.round(harga * persen / 100);
        const nilaiEfektif = coBroke ? harga * 0.5 : harga;
        const now          = new Date().toISOString();

        const trx = {
          ID:               formatTrxId(trxCount++),
          Elite_Program_ID: program?.ID || '',
          Agent_ID:         agentId,
          Agen_Nama:        agenNama,
          Tanggal:          tanggal,
          Bulan:            tanggal.slice(0, 7),
          Alamat_Transaksi: alamat,
          Tipe:             tipe,
          Co_Broke:         coBroke ? 'TRUE' : 'FALSE',
          Nilai_Transaksi:  harga,
          Komisi_Persen:    persen,
          Nilai_Komisi:     nilaiKomisi,
          Nilai_Efektif:    nilaiEfektif,
          Dibuat_Pada:      now,
          Diperbarui_Pada:  now,
          Ref_No_Transaksi: noTrx,
          Sumber:           'zkomisi_auto',
        };

        await sheetsService.appendRow(SHEETS.ELITE_TRANSACTIONS, COLUMNS.ELITE_TRANSACTIONS.map(c => trx[c] !== undefined ? trx[c] : ''));
        syncedKeys.add(dedupKey);
        results.synced++;
        console.log(`[ELITE-SYNC] ${noTrx} → ${agenNama} (${agentId || 'no-id'}) Rp ${harga.toLocaleString('id-ID')}`);
      } catch (e) {
        results.errors.push({ noTrx, nama, error: e.message });
        console.error(`[ELITE-SYNC] error ${noTrx} ${nama}:`, e.message);
      }
    }
  }

  return results;
}

module.exports = {
  rowsToObjects,
  sendWA,
  getPrincipalsWA,
  normalizePhoneTail,
  findAgentByPhone,
  listElitePrograms,
  getProgramByAgent,
  getProgramById,
  saveChecklist,
  activateElite,
  terminateProgram,
  getContent,
  updateContent,
  getTransactionsByAgent,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  runEliteCheck,
  runEliteKinerja,
  syncZKomisiElite,
  getAgentById,
};
