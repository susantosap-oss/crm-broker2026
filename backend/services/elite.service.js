/**
 * Elite Partner Service
 * Business logic for ELITE Partner System
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
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

function toRow(obj, cols) {
  return cols.map(c => obj[c] !== undefined ? obj[c] : '');
}

async function sendWA(token, target, message) {
  if (!token || !target) return;
  try {
    await axios.post('https://api.fonnte.com/send', { target, message }, {
      headers: { Authorization: token },
    });
  } catch (e) {
    console.error('[ELITE] WA send error:', e.message);
  }
}

async function getAgentFonnteToken(agentId) {
  try {
    const rows = await sheetsService.getRange(SHEETS.PA_CREDENTIALS);
    const objs = rowsToObjects(rows);
    const cred = objs.find(c => c.Agen_ID === agentId);
    return cred?.Fonnte_Token || null;
  } catch { return null; }
}

async function getPrincipalsTokens() {
  try {
    const rows = await sheetsService.getRange(SHEETS.AGENTS);
    const objs = rowsToObjects(rows);
    const principals = objs.filter(a => ['principal','kantor','superadmin'].includes(a.Role) && a.Status !== 'Nonaktif');
    const results = [];
    for (const p of principals) {
      const token = await getAgentFonnteToken(p.ID);
      if (token && p.No_WA) results.push({ token, no_wa: p.No_WA, nama: p.Nama });
    }
    return results;
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
  return objs.find(p => p.Agent_ID === agentId && ['Draft','Aktif'].includes(p.Status)) || null;
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

  await updateAgentEliteFields(agentId, '70:30', 'ELITE');

  const msg = `✅ *ELITE Partner Aktif!*\n\nHalo ${agent.Nama}, selamat! Anda resmi menjadi ELITE Partner Mansion.\n\n📅 Berlaku: ${tanggalMulai} s/d ${tanggalBerakhir}\n💰 Split Komisi: 70:30\n\nTetap semangat dan raih target Anda!`;
  const agentToken = await getAgentFonnteToken(agentId);
  if (agentToken && agent.No_WA) await sendWA(agentToken, agent.No_WA, msg);

  const adminMsg = `🏆 *ELITE Partner Baru!*\n\n${agent.Nama} (${agent.Nama_Kantor}) resmi menjadi ELITE Partner.\n📅 Berlaku: ${tanggalMulai} s/d ${tanggalBerakhir}\n\nDiaktifkan oleh: ${activatedBy}`;
  const principals = await getPrincipalsTokens();
  for (const p of principals) await sendWA(p.token, p.no_wa, adminMsg);

  return program;
}

async function terminateProgram(programId, reason, terminatedBy) {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const program = objs.find(p => p.ID === programId);
  if (!program) throw new Error('Program tidak ditemukan');
  if (program.Status !== 'Aktif') throw new Error('Program tidak sedang Aktif');

  program.Status = 'Gugur_Manual';
  program.Alasan_NonAktif = reason || '';
  program.Diperbarui_Pada = new Date().toISOString();
  await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, program._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => program[c] || ''));

  await updateAgentEliteFields(program.Agent_ID, program.Split_Sebelumnya || '', '');

  const agent = await getAgentById(program.Agent_ID);
  const msg = `⚠️ *Status ELITE Dihentikan*\n\nHalo ${agent?.Nama || program.Agen_Nama}, status ELITE Partner Anda telah dihentikan.\n\nAlasan: ${reason || '-'}\n\nHubungi kantor untuk informasi lebih lanjut.`;
  const agentToken = await getAgentFonnteToken(program.Agent_ID);
  if (agentToken && agent?.No_WA) await sendWA(agentToken, agent.No_WA, msg);

  const adminMsg = `⚠️ *ELITE Partner Dihentikan*\n\n${program.Agen_Nama} (${program.Nama_Kantor})\nAlasan: ${reason || '-'}\nOleh: ${terminatedBy}`;
  const principals = await getPrincipalsTokens();
  for (const p of principals) await sendWA(p.token, p.no_wa, adminMsg);

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

// ── Scheduler: Expiry + 60-day notif ─────────────────────

async function runEliteCheck() {
  const rows = await sheetsService.getRange(SHEETS.ELITE_PROGRAM);
  const objs = rowsToObjects(rows);
  const today = new Date();
  today.setHours(0,0,0,0);
  const results = [];

  for (const p of objs) {
    if (p.Status !== 'Aktif') continue;
    const end = new Date(p.Tanggal_Berakhir);
    if (isNaN(end.getTime())) continue;

    const diffMs = end - today;
    const diffDays = Math.floor(diffMs / (24*60*60*1000));

    if (diffDays <= 60 && p.Notif_60_Terkirim !== 'TRUE') {
      const agent = await getAgentById(p.Agent_ID);
      const msg = `⏰ *Notifikasi ELITE Partner*\n\nHalo ${p.Agen_Nama}, status ELITE Partner Anda akan berakhir dalam ${diffDays} hari (${p.Tanggal_Berakhir}).\n\nHubungi kantor untuk perpanjangan.`;
      const token = await getAgentFonnteToken(p.Agent_ID);
      if (token && agent?.No_WA) await sendWA(token, agent.No_WA, msg);
      const adminMsg = `⏰ ${p.Agen_Nama}: ELITE akan berakhir ${diffDays} hari lagi (${p.Tanggal_Berakhir})`;
      const principals = await getPrincipalsTokens();
      for (const pr of principals) await sendWA(pr.token, pr.no_wa, adminMsg);
      p.Notif_60_Terkirim = 'TRUE';
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      results.push({ id: p.ID, action: 'notif_60', agent: p.Agen_Nama });
    }

    if (diffDays < 0) {
      p.Status = 'Gugur_Expired';
      p.Alasan_NonAktif = 'Otomatis expired';
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      await updateAgentEliteFields(p.Agent_ID, p.Split_Sebelumnya || '', '');
      const agent = await getAgentById(p.Agent_ID);
      const msg = `⚠️ *ELITE Partner Berakhir*\n\nHalo ${p.Agen_Nama}, status ELITE Partner Anda telah berakhir (${p.Tanggal_Berakhir}).\n\nHubungi kantor untuk informasi perpanjangan.`;
      const token = await getAgentFonnteToken(p.Agent_ID);
      if (token && agent?.No_WA) await sendWA(token, agent.No_WA, msg);
      const adminMsg = `⚠️ ELITE Expired: ${p.Agen_Nama} (${p.Nama_Kantor}) — ${p.Tanggal_Berakhir}`;
      const principals = await getPrincipalsTokens();
      for (const pr of principals) await sendWA(pr.token, pr.no_wa, adminMsg);
      results.push({ id: p.ID, action: 'expired', agent: p.Agen_Nama });
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

    if (target > 0 && totalEfektif < threshold) {
      p.Status = 'Gugur_Kinerja';
      p.Alasan_NonAktif = `Kinerja Q${diffMonths/3}: Rp ${totalEfektif.toLocaleString()} < 80% target Rp ${threshold.toLocaleString()}`;
      p.Diperbarui_Pada = new Date().toISOString();
      await sheetsService.updateRow(SHEETS.ELITE_PROGRAM, p._rowIdx, COLUMNS.ELITE_PROGRAM.map(c => p[c] || ''));
      await updateAgentEliteFields(p.Agent_ID, p.Split_Sebelumnya || '', '');
      const agent = await getAgentById(p.Agent_ID);
      const msg = `⚠️ *ELITE Partner: Evaluasi Kinerja*\n\nHalo ${p.Agen_Nama}, evaluasi kinerja Q${diffMonths/3} menunjukkan pencapaian di bawah 80% target.\n\nTotal Efektif: Rp ${totalEfektif.toLocaleString()}\nTarget 80%: Rp ${threshold.toLocaleString()}\n\nStatus ELITE dihentikan. Hubungi kantor untuk informasi lebih lanjut.`;
      const token = await getAgentFonnteToken(p.Agent_ID);
      if (token && agent?.No_WA) await sendWA(token, agent.No_WA, msg);
      const adminMsg = `⚠️ ELITE Gugur Kinerja: ${p.Agen_Nama} — Efektif Rp ${totalEfektif.toLocaleString()} vs target 80% Rp ${threshold.toLocaleString()}`;
      const principals = await getPrincipalsTokens();
      for (const pr of principals) await sendWA(pr.token, pr.no_wa, adminMsg);
      results.push({ id: p.ID, action: 'gugur_kinerja', agent: p.Agen_Nama });
    } else {
      results.push({ id: p.ID, action: 'kinerja_ok', agent: p.Agen_Nama, totalEfektif });
    }
  }
  return results;
}

module.exports = {
  rowsToObjects,
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
  getAgentById,
};
