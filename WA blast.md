// @ts-nocheck
// ============================================================
// MANSION PROPERTI — GOOGLE APPS SCRIPT (FIXED VERSION)
// ============================================================
// SETUP:
//   Extensions > Apps Script > Project Settings > Script Properties
//   Key: FONNTE_TOKEN  →  Value: token Fonnte kamu
// ============================================================

const TZ            = 'Asia/Jakarta';
const CUT_OFF_AGENT = 19;   // input SAH sebelum jam 19.00
const CUT_OFF_TL    = 17;   // TL evaluasi setelah jam 17.00
const FONNTE_URL    = 'https://api.fonnte.com/send';
const FORM_URL      = 'https://forms.gle/59fBvShNXQhH4PLq6';

// ============================================================
// TOKEN FONNTE — ambil dari Script Properties
// ============================================================
function getFonnteToken() {
  const token = PropertiesService.getScriptProperties().getProperty('FONNTE_TOKEN');
  if (!token) throw new Error('FONNTE_TOKEN belum diset di Script Properties!');
  return token;
}

// ============================================================
// MAPPING KOLOM — FORM_HARIAN_RAW
// Header: Timestamp | Nama Agen | Team | Tanggal Aktifitas |
//         Jumlah Follow Up | Jumlah Kontak Baru | Jumlah Buyer Aktif |
//         Jumlah F.U Visit | Apakah Ada Deal | Catatan Singkat |
//         Jumlah Listing Baru | Berapa Kali Iklan
// ============================================================
const COL_RAW_TIMESTAMP = 0;
const COL_RAW_AGEN      = 1;
const COL_RAW_TEAM      = 2;
const COL_RAW_TGL       = 3;
const COL_RAW_FU        = 4;
const COL_RAW_KONTAK    = 5;
const COL_RAW_BUYER     = 6;
const COL_RAW_VISIT     = 7;
const COL_RAW_DEAL      = 8;
const COL_RAW_CATATAN   = 9;
const COL_RAW_LISTING   = 10;
const COL_RAW_IKLAN     = 11;

// ============================================================
// MAPPING KOLOM — DATA_AGEN
// Header: Agent_ID | Nama Agen | Team | No_WA | WA_FIX | Status
// ============================================================
const COL_AGEN_ID     = 0;
const COL_AGEN_NAMA   = 1;
const COL_AGEN_TEAM   = 2;
const COL_AGEN_WA     = 3;
const COL_AGEN_WA_FIX = 4;
const COL_AGEN_STATUS = 5;

// ============================================================
// MAPPING KOLOM — DATA_TL
// Header: Team | Nama TL | No_WA | WA_FIX_TL
// ============================================================
const COL_TL_TEAM   = 0;
const COL_TL_NAMA   = 1;
const COL_TL_WA     = 2;
const COL_TL_WA_FIX = 3;

// ============================================================
// ID FILE PER TEAM (Google Spreadsheet TL)
// ============================================================
const TEAM_FILES = {
  'Platinum' : '1fN5rDYPAiq5LhX-t5eOroxc2DLokTkBEZ4088kaBmdk',
  'Gold'     : '1H4C8EyyiX7eMVKLwSGT19FaGww1RzjvlYFRpCQraHYQ',
  'Principal': '1MpSk5isfQ3gMsgaz6xPs77o9zn2oiZMQaoBU5_OcZ-Q',
  'Malang'   : '1XP_uKPzZaBrHIeJryUzCoulBPiZVnrUHH6BL9m-K6sc'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getDayNameID() {
  const map = { 0:'Minggu', 1:'Senin', 2:'Selasa', 3:'Rabu', 4:'Kamis', 5:'Jumat', 6:'Sabtu' };
  return map[new Date().getDay()];
}

function normName(v) {
  if (!v) return '';
  return v.toString().trim().toLowerCase();
}

/**
 * Kirim WhatsApp via Fonnte API.
 * @param {string} target - Nomor WA tujuan
 * @param {string} message - Isi pesan
 */
function kirimWA(target, message) {
  if (!target || !message) {
    Logger.log('kirimWA: target atau message kosong, skip.');
    return;
  }
  try {
    const resp = UrlFetchApp.fetch(FONNTE_URL, {
      method           : 'post',
      headers          : { Authorization: getFonnteToken() },
      payload          : { target: target.toString(), message: message },
      muteHttpExceptions: true
    });
    const result = JSON.parse(resp.getContentText());
    if (!result.status) {
      Logger.log('WA GAGAL ke ' + target + ': ' + (result.reason || JSON.stringify(result)));
    }
    return result;
  } catch (err) {
    Logger.log('Error kirimWA ke ' + target + ': ' + err.toString());
  }
}

// ============================================================
// ON FORM SUBMIT — salin baris ke sheet bulan di file TL
// ============================================================
function onFormSubmit(e) {
  if (!e || !e.namedValues) return;
  try {
    const team = (e.namedValues['Team'] || [])[0];
    if (!team || !TEAM_FILES[team]) {
      Logger.log('onFormSubmit: team tidak dikenal → ' + team);
      return;
    }
    const rowValues = e.values;
    const tanggal   = new Date(e.namedValues['Timestamp'][0]);
    if (isNaN(tanggal.getTime())) {
      Logger.log('onFormSubmit: timestamp tidak valid');
      return;
    }
    const bulan    = Utilities.formatDate(tanggal, TZ, 'yyyy-MM');
    const ssTarget = SpreadsheetApp.openById(TEAM_FILES[team]);
    let sheetBulan = ssTarget.getSheetByName(bulan);
    if (!sheetBulan) {
      sheetBulan = ssTarget.insertSheet(bulan);
      const ssMaster = SpreadsheetApp.getActiveSpreadsheet();
      const shRaw    = ssMaster.getSheetByName('FORM_HARIAN_RAW');
      const header   = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
      sheetBulan.appendRow(header);
      const lastCol = header.length;
      sheetBulan.setFrozenRows(1);
      sheetBulan.getRange(1, 1, 1, lastCol)
        .setBackground('#1f3a5f').setFontColor('#ffffff')
        .setWrap(true).setVerticalAlignment('middle')
        .setHorizontalAlignment('center').setFontWeight('bold');
      sheetBulan.getRange(1, 1, lastCol + 1, lastCol).createFilter();
    }
    sheetBulan.appendRow(rowValues);
  } catch (err) {
    Logger.log('Error onFormSubmit: ' + err.toString());
  }
}

// ============================================================
// AUTO LOCK SHEET BULAN LAMA (proteksi sheet selain bulan ini)
// ============================================================
function autoLockOldMonthSheets() {
  const currentMonth = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss = SpreadsheetApp.openById(fileId);
    ss.getSheets().forEach(sh => {
      const name = sh.getName();
      if (!/^\d{4}-\d{2}$/.test(name)) return;
      if (name === currentMonth) return;
      const protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if (protections.length === 0) {
        const p = sh.protect().setDescription('AUTO LOCK ' + name);
        p.removeEditors(p.getEditors());
        p.addEditor(Session.getEffectiveUser());
        Logger.log('[LOCKED] ' + team + ' → ' + name);
      }
    });
  });
  Logger.log('✅ AUTO LOCK BULAN LAMA SELESAI');
}

// ============================================================
// REKAP BULANAN TEAM — ke sheet REKAP_BULANAN_TEAM
// Header: Bulan | Team | Total Follow Up | Total Visit | Total Deal | Jumlah Agen Aktif
// ============================================================
function buildRekapBulananTeam() {
  const today = new Date();
  // Bulan lalu: getMonth()-1 aman di JS (Januari → Desember tahun lalu otomatis)
  const month        = today.getMonth() - 1;
  const startOfMonth = new Date(today.getFullYear(), month, 1, 0, 0, 0);
  const endOfMonth   = new Date(today.getFullYear(), month + 1, 0, 23, 59, 59);
  const bulanText    = Utilities.formatDate(startOfMonth, TZ, 'MMM yyyy');

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();

  const sheetName = 'REKAP_BULANAN_TEAM';
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Bulan','Team','Total Follow Up','Total Visit','Total Deal','Jumlah Agen Aktif']);
  }

  // Hitung stats per team
  const stats = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < startOfMonth || ts > endOfMonth) continue;
    const team = raw[i][COL_RAW_TEAM];
    if (!team) continue;

    const fu      = Number(raw[i][COL_RAW_FU])     || 0;
    const visit   = Number(raw[i][COL_RAW_VISIT])   || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const agen    = normName(raw[i][COL_RAW_AGEN]);

    if (!stats[team]) stats[team] = { fu:0, visit:0, deal:0, listing:0, agenAktif: new Set() };
    stats[team].fu      += fu;
    stats[team].visit   += visit;
    stats[team].listing += listing;
    if (dealYes) stats[team].deal += 1;
    if (agen)    stats[team].agenAktif.add(agen);
  }

  Object.keys(stats).forEach(team => {
    sh.appendRow([
      bulanText,
      team,
      stats[team].fu,
      stats[team].visit,
      stats[team].deal,
      stats[team].agenAktif.size
    ]);
  });
  Logger.log('✅ REKAP BULANAN TEAM SELESAI');
}

// ============================================================
// REMINDER EMAIL AGEN BELUM INPUT
// ============================================================
function reminderAgenBelumInput() {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const raw   = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenData = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();

  const agenInputHariIni = new Set();
  for (let i = 1; i < raw.length; i++) {
    const ts  = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tgl = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    if (tgl === today) agenInputHariIni.add(normName(raw[i][COL_RAW_AGEN]));
  }

  for (let i = 1; i < agenData.length; i++) {
    const nama  = agenData[i][COL_AGEN_NAMA];
    const email = agenData[i][COL_AGEN_WA];   // Gunakan kolom No_WA sebagai fallback; ganti ke kolom email jika ada
    if (!nama || !email) continue;
    if (agenInputHariIni.has(normName(nama))) continue;

    try {
      MailApp.sendEmail({
        to     : email,
        subject: '⏰ Reminder Aktivitas Harian',
        body   : `Halo ${nama},\n\nAnda belum mengisi Form Aktivitas hari ini.\nMohon diisi sebelum jam kerja berakhir.\n\nTerima kasih.`
      });
    } catch (err) {
      Logger.log('Gagal kirim email ke ' + nama + ': ' + err.toString());
    }
  }
}

// ============================================================
// WA REMINDER PERTAMA KE AGEN (dengan dedup harian via Properties)
// ============================================================
// ============================================================
// [DEPRECATED] waReminderKeAgen — tidak digunakan lagi
// Digantikan oleh waReminderMalamGroupTL
// ============================================================
function waReminderKeAgen() {
  Logger.log('[DEPRECATED] waReminderKeAgen tidak aktif. Gunakan waReminderMalamGroupTL.');
}

// ============================================================
// [DEPRECATED] waReminderAgenKedua — tidak digunakan lagi
// Digantikan oleh waReminderMalamGroupTL
// ============================================================
function waReminderAgenKedua() {
  Logger.log('[DEPRECATED] waReminderAgenKedua tidak aktif. Gunakan waReminderMalamGroupTL.');
}

// ============================================================
// WA KE GROUP TL BERDASARKAN TEAM (sheet: DATA_GROUP_TL)
// Kolom: Team | Nama Group | Group_ID | Is_Active
// ============================================================
function sendWAToGroupByTeam(team, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('DATA_GROUP_TL');
  if (!sh) { Logger.log('Sheet DATA_GROUP_TL tidak ditemukan'); return; }

  const data    = sh.getDataRange().getValues();
  const teamFix = team.toString().trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const rowTeam  = (data[i][0] || '').toString().trim().toLowerCase();
    const groupId  = data[i][2];
    const isActive = data[i][3];
    if (rowTeam === teamFix && isActive === true && groupId) {
      Logger.log('SEND TO GROUP: ' + groupId + ' (team: ' + team + ')');
      kirimWA(groupId, message);
      return;
    }
  }
  Logger.log('Group tidak ditemukan atau tidak aktif untuk team: ' + team);
}

// ============================================================
// TEMPLATE HELPERS (dari sheet TEMPLATE_WA_*)
// ============================================================
function getMorningTemplateTLByDay(dayName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TEMPLATE_WA_MORNING_TL');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dayName && data[i][1] === true && data[i][2]) return data[i][2];
  }
  return null;
}

function getReminderTemplateByDay(dayName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TEMPLATE_WA_REMINDER');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dayName && data[i][1] === true && data[i][2]) {
      return { message: data[i][2] };
    }
  }
  return null;
}

function getMorningTemplateByDay(dayName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TEMPLATE_WA_MORNING');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dayName && data[i][1] === true && data[i][2]) {
      return { message: data[i][2], reminder: data[i][3] };
    }
  }
  return null;
}

function getMalamTemplateByDay(dayName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TEMPLATE_WA_MALAM');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dayName && data[i][1] === true && data[i][2]) {
      return data[i][2];
    }
  }
  return null;
}

// ============================================================
// WA REMINDER MALAM KE GROUP TL
// Trigger: jam 19.00–20.00 setiap hari
// Konten: jumlah agen belum isi form sampai pukul 19.00
// Tidak menyebut nama agen, hanya jumlah & nama group TL
// Jeda 5 menit antar grup untuk menghindari deteksi spam WA
// ============================================================
function waReminderMalamGroupTL() {
  const SLEEP_MS  = 5 * 60 * 1000; // 5 menit
  const todayKey  = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dayName   = getDayNameID();

  // Ambil template dari TEMPLATE_WA_MALAM
  const tplText = getMalamTemplateByDay(dayName);
  if (!tplText) {
    Logger.log('Template TEMPLATE_WA_MALAM tidak ditemukan untuk hari: ' + dayName);
    return;
  }

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const groupData = ss.getSheetByName('DATA_GROUP_TL').getDataRange().getValues();

  // Hitung agen per team yang sudah input SAH (sebelum jam CUT_OFF_AGENT)
  const agenSudahPerTeam = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsKey  = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    const tsHour = ts.getHours();
    if (tsKey === todayKey && tsHour < CUT_OFF_AGENT) {
      const team = raw[i][COL_RAW_TEAM];
      const agen = normName(raw[i][COL_RAW_AGEN]);
      if (!team || !agen) continue;
      if (!agenSudahPerTeam[team]) agenSudahPerTeam[team] = new Set();
      agenSudahPerTeam[team].add(agen);
    }
  }

  // Hitung total agen terdaftar per team
  const totalAgenPerTeam = {};
  for (let i = 1; i < agenSheet.length; i++) {
    const team = agenSheet[i][COL_AGEN_TEAM];
    if (!team) continue;
    if (!totalAgenPerTeam[team]) totalAgenPerTeam[team] = 0;
    totalAgenPerTeam[team]++;
  }

  // Kirim ke tiap grup aktif dengan jeda 5 menit
  let sentCount = 0;
  for (let i = 1; i < groupData.length; i++) {
    const team     = groupData[i][0];
    const groupId  = groupData[i][2];
    const isActive = groupData[i][3];
    if (!team || !groupId || isActive !== true) continue;

    const sudah    = agenSudahPerTeam[team]?.size || 0;
    const total    = totalAgenPerTeam[team]        || 0;
    const belumIsi = total - sudah;

    // Hanya kirim jika ada agen yang belum isi
    if (belumIsi <= 0) {
      Logger.log('[SKIP] ' + team + ' → semua agen sudah isi');
      continue;
    }

    const message = tplText
      .replace('{{team}}',     team)
      .replace('{{belum_isi}}', belumIsi);

    // Jeda 5 menit sebelum kirim (kecuali grup pertama)
    if (sentCount > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke grup: ' + team);
      Utilities.sleep(SLEEP_MS);
    }

    Logger.log('[KIRIM MALAM] ' + team + ' → ' + belumIsi + ' agen belum isi');
    kirimWA(groupId, message);
    sentCount++;
  }

  Logger.log('✅ REMINDER MALAM GROUP TL SELESAI | Terkirim: ' + sentCount + ' grup');
}

// ============================================================
// WA UCAPAN PAGI TL → GROUP (rangkuman agen isi kemarin + listing WTD)
// ============================================================
function waUcapanPagiTL_Group() {
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayKey     = Utilities.formatDate(today, TZ, 'yyyy-MM-dd');
  const yesterdayKey = Utilities.formatDate(yesterday, TZ, 'yyyy-MM-dd');

  // Senin minggu ini
  const day          = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday       = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const mondayKey = Utilities.formatDate(monday, TZ, 'yyyy-MM-dd');

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();

  const agenIsiKemarinPerTeam = {};
  const listingWTDPerTeam     = {};

  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsKey = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    const team  = raw[i][COL_RAW_TEAM];
    if (!team) continue;

    if (tsKey === yesterdayKey) {
      if (!agenIsiKemarinPerTeam[team]) agenIsiKemarinPerTeam[team] = new Set();
      agenIsiKemarinPerTeam[team].add(normName(raw[i][COL_RAW_AGEN]));
    }
    if (tsKey >= mondayKey && tsKey <= todayKey) {
      if (!listingWTDPerTeam[team]) listingWTDPerTeam[team] = 0;
      listingWTDPerTeam[team] += Number(raw[i][COL_RAW_LISTING]) || 0;
    }
  }

  const dayName = getDayNameID();
  const tpl     = getMorningTemplateTLByDay(dayName);
  if (!tpl) { Logger.log('Template TEMPLATE_WA_MORNING_TL tidak ditemukan'); return; }

  const groupSheet = ss.getSheetByName('DATA_GROUP_TL').getDataRange().getValues();
  for (let i = 1; i < groupSheet.length; i++) {
    const team     = groupSheet[i][0];
    const isActive = groupSheet[i][3];
    if (isActive !== true) continue;

    const isi        = agenIsiKemarinPerTeam[team]?.size || 0;
    const listingWTD = listingWTDPerTeam[team] || 0;

    const message = tpl
      .replace('{{team}}', team)
      .replace('{{isi}}', isi)
      .replace('{{listing_wtd}}', listingWTD)
      .replace('{{link_form}}', FORM_URL);

    sendWAToGroupByTeam(team, message);
  }
}

// ============================================================
// WA UCAPAN PAGI + BADGE KE AGEN (personal)
// ============================================================
function waUcapanPagiDenganBadge() {
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = Utilities.formatDate(yesterday, TZ, 'yyyy-MM-dd');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();

  const dayName = getDayNameID();
  const tpl     = getMorningTemplateByDay(dayName);
  if (!tpl) { Logger.log('Template morning agen tidak ditemukan'); return; }

  const agenIsiKemarin = new Set();
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsDate = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    if (tsDate === yesterdayKey) agenIsiKemarin.add(normName(raw[i][COL_RAW_AGEN]));
  }

  for (let i = 1; i < agenSheet.length; i++) {
    const nama = agenSheet[i][COL_AGEN_NAMA];
    const wa   = agenSheet[i][COL_AGEN_WA_FIX];
    if (!nama || !wa) continue;

    let message = tpl.message.replace('{{nama}}', nama);
    if (agenIsiKemarin.has(normName(nama))) {
      message += '\n🏅 *Badge Disiplin*\nTerima kasih sudah konsisten mengisi aktivitas kemarin.\nTerus pertahankan ya 👍';
    }
    if (tpl.reminder) message += '\n' + tpl.reminder;
    message += '\n*Mansion Properti*';

    kirimWA(wa, message);
  }
}

// ============================================================
// WA UCAPAN PAGI KE TL (personal, ringkasan kemarin + listing WTD)
// ============================================================
function waUcapanPagiTL() {
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = Utilities.formatDate(yesterday, TZ, 'yyyy-MM-dd');
  const todayKey     = Utilities.formatDate(today, TZ, 'yyyy-MM-dd');

  const day          = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday       = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const mondayKey = Utilities.formatDate(monday, TZ, 'yyyy-MM-dd');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const tlSheet   = ss.getSheetByName('DATA_TL').getDataRange().getValues();

  const agenIsiKemarinPerTeam = {};
  const listingWTDPerTeam     = {};

  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsKey = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    const team  = raw[i][COL_RAW_TEAM];   // FIX: kolom 2 = Team ✅
    if (!team) continue;

    if (tsKey === yesterdayKey) {
      if (!agenIsiKemarinPerTeam[team]) agenIsiKemarinPerTeam[team] = new Set();
      agenIsiKemarinPerTeam[team].add(normName(raw[i][COL_RAW_AGEN]));
    }
    if (tsKey >= mondayKey && tsKey <= todayKey) {
      if (!listingWTDPerTeam[team]) listingWTDPerTeam[team] = 0;
      listingWTDPerTeam[team] += Number(raw[i][COL_RAW_LISTING]) || 0;
    }
  }

  const totalAgenPerTeam = {};
  for (let i = 1; i < agenSheet.length; i++) {
    const team = agenSheet[i][COL_AGEN_TEAM];
    if (!totalAgenPerTeam[team]) totalAgenPerTeam[team] = 0;
    totalAgenPerTeam[team]++;
  }

  for (let i = 1; i < tlSheet.length; i++) {
    const team   = tlSheet[i][COL_TL_TEAM];
    const namaTL = tlSheet[i][COL_TL_NAMA];
    const waTL   = tlSheet[i][COL_TL_WA_FIX];   // FIX: index 3 = WA_FIX_TL ✅
    if (!waTL) continue;

    const isi        = agenIsiKemarinPerTeam[team]?.size || 0;
    const listingWTD = listingWTDPerTeam[team] || 0;

    const message =
`Selamat pagi ${namaTL} ☀️
Semoga hari ini lancar dan produktif.
Ringkasan singkat tim ${team}:
• Agen isi aktivitas kemarin : ${isi} orang ⭐
• Jumlah Listing minggu ini  : ${listingWTD} listing
Semangat memimpin tim hari ini 💪
*Mansion Properti*`;

    kirimWA(waTL, message);
  }
}

// ============================================================
// WA RINGKASAN HARIAN KE TL (agen belum submit sampai jam CUT_OFF_TL)
// ============================================================
function waRingkasanKeTL() {
  const nowHour = new Date().getHours();
  if (nowHour < CUT_OFF_TL) {
    Logger.log('Belum jam ' + CUT_OFF_TL + ', ringkasan TL tidak dikirim.');
    return;
  }

  const today     = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const todayText = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const tlSheet   = ss.getSheetByName('DATA_TL').getDataRange().getValues();

  // Daftar semua agen per team
  const agenPerTeam = {};
  for (let i = 1; i < agenSheet.length; i++) {
    const nama = agenSheet[i][COL_AGEN_NAMA];
    const team = agenSheet[i][COL_AGEN_TEAM];
    if (!nama || !team) continue;
    if (!agenPerTeam[team]) agenPerTeam[team] = [];
    agenPerTeam[team].push(nama);
  }

  // Agen yang sudah submit SAH hari ini (sebelum CUT_OFF_AGENT)
  const agenSubmitSahPerTeam = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsDate = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    const tsHour = ts.getHours();
    if (tsDate === today && tsHour < CUT_OFF_AGENT) {
      const team = raw[i][COL_RAW_TEAM];   // FIX: kolom 2 = Team ✅
      const agen = raw[i][COL_RAW_AGEN];   // FIX: kolom 1 = Nama Agen ✅
      if (!team || !agen) continue;
      if (!agenSubmitSahPerTeam[team]) agenSubmitSahPerTeam[team] = new Set();
      agenSubmitSahPerTeam[team].add(normName(agen));
    }
  }

  for (let i = 1; i < tlSheet.length; i++) {
    const team   = tlSheet[i][COL_TL_TEAM];
    const namaTL = tlSheet[i][COL_TL_NAMA];
    const waTL   = tlSheet[i][COL_TL_WA_FIX];   // FIX: index 3 = WA_FIX_TL ✅
    if (!waTL || !agenPerTeam[team]) continue;

    const sudahSet = agenSubmitSahPerTeam[team] || new Set();
    const belum = agenPerTeam[team].filter(a => !sudahSet.has(normName(a)));
    if (belum.length === 0) continue;

    const message =
`Ringkasan otomatis (${team}) – ${todayText}
Agen belum update aktivitas:
${belum.map(a => '- ' + a).join('\n')}
(Sistem otomatis)`;

    kirimWA(waTL, message);
  }
}

// ============================================================
// UPDATE STATUS AGEN MINGGUAN (7 hari ke belakang, simpan ke DATA_AGEN kolom Status)
// ============================================================
// ============================================================
// MAPPING KOLOM — SCOREBOARD_AGEN
// Header: Agent_ID | Nama Agen | Team | CR HOT | Closing | Score | Rank | Agent_Category | iFastTrack | FT_STATUS | FT_FLAG
// ============================================================
const COL_SB_ID            = 0;
const COL_SB_NAMA          = 1;
const COL_SB_TEAM          = 2;
const COL_SB_CRHOT         = 3;
const COL_SB_CLOSING       = 4;
const COL_SB_SCORE         = 5;
const COL_SB_RANK          = 6;
const COL_SB_AGENT_CAT     = 7;
const COL_SB_IFAST_TRACK   = 8;
const COL_SB_FT_STATUS     = 9;
const COL_SB_FT_FLAG       = 10;

// ============================================================
// UPDATE STATUS AGEN MINGGUAN + KIRIM WA KE GROUP TL
// - Update kolom Status di DATA_AGEN
// - Baca iFastTrack & FT_FLAG dari SCOREBOARD_AGEN
// - Hitung Listing & Closing minggu lalu dari FORM_HARIAN_RAW
// - Kirim ringkasan ke group TL per team (tanpa sebut nama agen)
// - Jeda 5 menit antar grup
// ============================================================
function updateStatusAgenMingguanGrupTL() {
  const SLEEP_MS = 5 * 60 * 1000; // 5 menit

  const today     = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  // Periode minggu lalu (Senin–Minggu sebelumnya)
  const day          = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const thisMonday   = new Date(today);
  thisMonday.setDate(today.getDate() + diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  lastSunday.setHours(23, 59, 59, 999);

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN');
  const agenData  = agenSheet.getDataRange().getValues();

  // ── 1. Update kolom Status di DATA_AGEN (7 hari ke belakang) ──
  const counter = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsHour = ts.getHours();
    if (ts >= startDate && ts <= today && tsHour < CUT_OFF_AGENT) {
      const agen   = normName(raw[i][COL_RAW_AGEN]);
      const dayKey = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
      if (!counter[agen]) counter[agen] = new Set();
      counter[agen].add(dayKey);
    }
  }
  for (let i = 1; i < agenData.length; i++) {
    const nama  = agenData[i][COL_AGEN_NAMA];
    const key   = normName(nama);
    const total = counter[key]?.size || 0;
    let status  = 'INACTIVE';
    if (total >= 4)      status = 'ACTIVE';
    else if (total >= 1) status = 'POTENTIAL';
    agenSheet.getRange(i + 1, COL_AGEN_STATUS + 1).setValue(status);
  }
  Logger.log('✅ STATUS AGEN MINGGUAN DIUPDATE');

  // ── 2. Hitung Listing & Closing minggu lalu per team dari FORM_HARIAN_RAW ──
  const weeklyStats = {}; // key: team → { listing: 0, closing: 0 }
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < lastMonday || ts > lastSunday) continue;
    const team    = raw[i][COL_RAW_TEAM];
    if (!team) continue;
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';
    if (!weeklyStats[team]) weeklyStats[team] = { listing: 0, closing: 0 };
    weeklyStats[team].listing += listing;
    if (dealYes) weeklyStats[team].closing += 1;
  }

  // ── 3. Baca SCOREBOARD_AGEN untuk iFastTrack & FT_FLAG per team ──
  const sbSheet = ss.getSheetByName('SCOREBOARD_AGEN');
  if (!sbSheet) {
    Logger.log('⚠️ Sheet SCOREBOARD_AGEN tidak ditemukan');
    return;
  }
  const sbData = sbSheet.getDataRange().getValues();

  // Hitung jumlah per kategori Agent_Category dan FT_FLAG per team
  // Agent_Category: Top Performer | Performer | Developing | Starter | In Training | ⚠️ Attention
  // FT_FLAG: 🏆 ELITE | ⭐ PRIORITY | ✅ READY | (kosong)
  const sbPerTeam = {};
  for (let i = 1; i < sbData.length; i++) {
    const team    = sbData[i][COL_SB_TEAM];
    const cat     = (sbData[i][COL_SB_AGENT_CAT] || '').toString().trim();
    const ftFlag  = (sbData[i][COL_SB_FT_FLAG]   || '').toString().trim();
    if (!team) continue;
    if (!sbPerTeam[team]) sbPerTeam[team] = {
      topPerformer : 0,
      performer    : 0,
      developing   : 0,
      starter      : 0,
      inTraining   : 0,
      attention    : 0,
      elite        : 0,
      priority     : 0,
      ready        : 0
    };
    const t = sbPerTeam[team];
    if (cat === 'Top Performer')   t.topPerformer++;
    else if (cat === 'Performer')  t.performer++;
    else if (cat === 'Developing') t.developing++;
    else if (cat === 'Starter')    t.starter++;
    else if (cat === 'In Training')t.inTraining++;
    else if (cat.includes('Attention')) t.attention++;

    if (ftFlag.includes('ELITE'))    t.elite++;
    else if (ftFlag.includes('PRIORITY')) t.priority++;
    else if (ftFlag.includes('READY'))    t.ready++;
  }

  // ── 4. Kirim WA ke group TL per team dengan jeda 5 menit ──
  const groupData = ss.getSheetByName('DATA_GROUP_TL').getDataRange().getValues();
  let sentCount   = 0;

  for (let i = 1; i < groupData.length; i++) {
    const team     = groupData[i][0];
    const groupId  = groupData[i][2];
    const isActive = groupData[i][3];
    if (!team || !groupId || isActive !== true) continue;

    const sb = sbPerTeam[team]   || { topPerformer:0, performer:0, developing:0, starter:0, inTraining:0, attention:0, elite:0, priority:0, ready:0 };
    const ws = weeklyStats[team] || { listing: 0, closing: 0 };

    const message =
`Selamat Pagi Team ${team} ☀️
Berikut update status member team minggu lalu:
📊 Agent Category:
• Top Performer : ${sb.topPerformer} agen
• Performer     : ${sb.performer} agen
• Developing    : ${sb.developing} agen
• Starter       : ${sb.starter} agen
• In Training   : ${sb.inTraining} agen
• ⚠️ Attention  : ${sb.attention} agen
🎯 Fast Track Flag:
• 🏆 ELITE      : ${sb.elite} agen
• ⭐ PRIORITY   : ${sb.priority} agen
• ✅ READY      : ${sb.ready} agen
📈 Aktivitas Minggu Lalu:
• Jumlah Listing : ${ws.listing}
• Jumlah Closing : ${ws.closing}
Tetap semangat dan pertahankan performa terbaik! 💪
Mansion Citraland`;

    if (sentCount > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke grup: ' + team);
      Utilities.sleep(SLEEP_MS);
    }

    Logger.log('[KIRIM STATUS] ' + team + ' → group: ' + groupId);
    kirimWA(groupId, message);
    sentCount++;
  }

  Logger.log('✅ UPDATE STATUS & WA GROUP TL SELESAI | Terkirim: ' + sentCount + ' grup');
}

// ============================================================
// WA EVALUASI MINGGUAN AGEN (Senin, rekap minggu lalu)
// ============================================================
function waEvaluasiMingguanAgen() {
  const today        = new Date();
  const day          = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const thisMonday   = new Date(today);
  thisMonday.setDate(today.getDate() + diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  lastSunday.setHours(23, 59, 59, 999);

  const periodText =
    Utilities.formatDate(lastMonday, TZ, 'dd MMM') + ' – ' +
    Utilities.formatDate(lastSunday, TZ, 'dd MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet  = ss.getSheetByName('FORM_HARIAN_RAW');
  const agenSheet = ss.getSheetByName('DATA_AGEN');
  if (!rawSheet || !agenSheet) throw new Error('Sheet FORM_HARIAN_RAW atau DATA_AGEN tidak ditemukan');

  const raw      = rawSheet.getDataRange().getValues();
  const agenData = agenSheet.getDataRange().getValues();

  const stats = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < lastMonday || ts > lastSunday) continue;

    const agen = normName(raw[i][COL_RAW_AGEN]);
    if (!agen) continue;

    const team    = raw[i][COL_RAW_TEAM];
    const fu      = Number(raw[i][COL_RAW_FU])      || 0;
    const kontak  = Number(raw[i][COL_RAW_KONTAK])  || 0;
    const buyer   = Number(raw[i][COL_RAW_BUYER])   || 0;
    const closing = Number(raw[i][COL_RAW_DEAL] === 'Ya' ? 1 : 0);
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const iklan   = Number(raw[i][COL_RAW_IKLAN])   || 0;

    if (!stats[agen]) stats[agen] = { team, fu:0, kontak:0, buyer:0, closing:0, iklan:0, listing:0, days: new Set() };
    const dayKey = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    stats[agen].fu      += fu;
    stats[agen].kontak  += kontak;
    stats[agen].buyer   += buyer;
    stats[agen].closing += closing;
    stats[agen].iklan   += iklan;
    stats[agen].listing += listing;
    stats[agen].days.add(dayKey);
  }

  // Update Master KPI DULU agar col 8/9/10 (ARRAYFORMULA) sudah terhitung
  updateMasterKPI();

  // Baca Master_KPI_Agent untuk ambil iFastTrack, FT_STATUS, FT_FLAG per agen
  const masterSheet = ss.getSheetByName('Master_KPI_Agent');
  const masterData  = masterSheet ? masterSheet.getDataRange().getValues() : [];
  const kpiInfoMap  = {};  // key: normName(nama) → { iFastTrack, ftStatus, ftFlag }
  for (let i = 1; i < masterData.length; i++) {
    const nama = masterData[i][COL_KPI_MASTER_NAMA];
    if (!nama) continue;
    kpiInfoMap[normName(nama)] = {
      iFastTrack : masterData[i][8] || '-',
      ftStatus   : masterData[i][9] || '-',
      ftFlag     : masterData[i][10] || ''
    };
  }

  for (let i = 1; i < agenData.length; i++) {
    const nama = agenData[i][COL_AGEN_NAMA];
    const wa   = agenData[i][COL_AGEN_WA_FIX];
    if (!nama || !wa) continue;

    const key       = normName(nama);
    const d         = stats[key];
    const hariAktif = d ? d.days.size  : 0;
    const fu        = d ? d.fu         : 0;
    const kontak    = d ? d.kontak     : 0;
    const buyer     = d ? d.buyer      : 0;
    const closing   = d ? d.closing    : 0;
    const iklan     = d ? d.iklan      : 0;
    const listing   = d ? d.listing    : 0;
    const team      = d ? d.team       : '-';

    const crHot        = kontak > 0 ? buyer / kontak : 0;
    const crClosing    = buyer  > 0 ? closing / buyer : 0;
    const crHotPct     = (crHot * 100).toFixed(1) + '%';
    const crClosingPct = (crClosing * 100).toFixed(1) + '%';

    let status  = 'NONACTIVE';
    let catatan = 'Belum ada aktivitas tercatat minggu lalu. Silakan koordinasi dengan TL.';
    if (hariAktif >= 4)      { status = 'ACTIVE';    catatan = 'Aktivitas konsisten. Pertahankan dan fokus ke buyer HOT & closing.'; }
    else if (hariAktif >= 1) { status = 'POTENSIAL'; catatan = 'Aktivitas sudah ada, tingkatkan follow up dan visit.'; }
    if (kontak > 0 && crHot < 0.3) catatan = 'Perlu meningkatkan kualitas follow up & kualifikasi buyer.';
    if (buyer  > 0 && crClosing < 0.15) catatan = 'Buyer sudah ada, fokus ke negosiasi & teknik closing.';

    // Ambil info KPI dari Master_KPI_Agent
    const kpi        = kpiInfoMap[key] || {};
    const iFastTrack = kpi.iFastTrack || '-';
    const ftStatus   = kpi.ftStatus   || '-';
    const ftFlag     = kpi.ftFlag     || '';

    const message =
`📊 Evaluasi Mingguan Aktivitas
Periode: ${periodText}
Nama Agen : ${nama}
Team      : ${team}
• Hari Aktif : ${hariAktif} hari
• Follow Up  : ${fu}
• Iklan      : ${iklan}
• Listing    : ${listing}
📈 Konversi Mingguan
• CR Buyer HOT     : ${crHotPct}
• CR Potensi Close : ${crClosingPct}
Status Mingguan : ${status}
🎯 KPI & Fast Track
• Kategori    : ${iFastTrack}
• FT Status   : ${ftStatus}${ftFlag ? '\n• FT Flag     : ' + ftFlag : ''}
Catatan:
${catatan}
(Sistem otomatis Mansion Properti)`;

    kirimWA(wa, message);
  }

  Logger.log('✅ EVALUASI MINGGUAN AGEN SELESAI');
}

// ============================================================
// WA RINGKASAN MINGGUAN KE TL
// ============================================================
function waRingkasanMingguanTL() {
  const today     = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  const todayText = Utilities.formatDate(today, TZ, 'dd MMM yyyy');
  const startText = Utilities.formatDate(startDate, TZ, 'dd MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const tlSheet   = ss.getSheetByName('DATA_TL').getDataRange().getValues();

  const counter = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const tsHour = ts.getHours();
    if (ts >= startDate && ts <= today && tsHour < CUT_OFF_AGENT) {
      const team   = raw[i][COL_RAW_TEAM];
      const agen   = normName(raw[i][COL_RAW_AGEN]);
      const dayKey = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
      if (!counter[team]) counter[team] = {};
      if (!counter[team][agen]) counter[team][agen] = new Set();
      counter[team][agen].add(dayKey);
    }
  }

  // Update Master KPI DULU agar col 8/9/10 (ARRAYFORMULA) sudah terhitung
  updateMasterKPI();

  // Baca Master_KPI_Agent untuk summary FT per team
  const masterSheet = ss.getSheetByName('Master_KPI_Agent');
  const masterData  = masterSheet ? masterSheet.getDataRange().getValues() : [];
  const ftPerTeam   = {};  // key: team → { eligible: 0, total: 0 }
  for (let i = 1; i < masterData.length; i++) {
    const team     = masterData[i][COL_KPI_MASTER_TEAM];
    const ftStatus = (masterData[i][9] || '').toString();
    if (!team) continue;
    if (!ftPerTeam[team]) ftPerTeam[team] = { eligible: 0, total: 0 };
    ftPerTeam[team].total++;
    if (ftStatus.includes('FAST TRACK ELIGIBLE')) ftPerTeam[team].eligible++;
  }

  const SLEEP_MS = 5 * 60 * 1000; // 5 menit
  let sentCount  = 0;

  for (let i = 1; i < tlSheet.length; i++) {
    const team   = tlSheet[i][COL_TL_TEAM];
    const namaTL = tlSheet[i][COL_TL_NAMA];
    const waTL   = tlSheet[i][COL_TL_WA_FIX];
    if (!waTL || !counter[team]) continue;

    const agenTeam = agenSheet
      .filter((r, idx) => idx > 0 && r[COL_AGEN_TEAM] === team)
      .map(r => r[COL_AGEN_NAMA]);

    const ranking = agenTeam.map(nama => ({
      nama,
      total: counter[team][normName(nama)]?.size || 0
    })).sort((a, b) => b.total - a.total);

    const top3    = ranking.slice(0, 3);
    const bottom3 = ranking.slice(-3);
    const avg     = ranking.length
      ? Math.round(ranking.reduce((s, a) => s + a.total, 0) / (ranking.length * 7) * 100)
      : 0;

    // Summary Fast Track team ini
    const ftInfo     = ftPerTeam[team] || { eligible: 0, total: 0 };
    const ftEligible = ftInfo.eligible;
    const ftTotal    = ftInfo.total;

    const message =
`Ringkasan Mingguan Team ${team}
Periode: ${startText} – ${todayText}
Total Agen: ${ranking.length}
Rata-rata kepatuhan: ${avg}%
🏆 Top 3 Disiplin:
${top3.map((a, i) => (i + 1) + '. ' + a.nama + ' (' + a.total + '/7)').join('\n')}
⚠️ Perlu Perhatian:
${bottom3.map(a => '- ' + a.nama + ' (' + a.total + '/7)').join('\n')}
🎯 Fast Track Summary:
• Eligible    : ${ftEligible} dari ${ftTotal} agen
• Pra FT      : ${ftTotal - ftEligible} agen
(Sistem otomatis)`;

    if (sentCount > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke TL: ' + namaTL);
      Utilities.sleep(SLEEP_MS);
    }
    kirimWA(waTL, message);
    sentCount++;
  }

  Logger.log('✅ RINGKASAN MINGGUAN TL SELESAI');
}

// ============================================================
// WA EVALUASI BULANAN AGEN → GROUP TL + SIMPAN KE FILE TL
// - Hitung Listing & Closing bulan lalu per team dari FORM_HARIAN_RAW
// - Baca Agent_Category & FT_FLAG dari SCOREBOARD_AGEN
// - Kirim ringkasan ke group TL per team (tanpa sebut nama agen)
// - Simpan rekap per agen ke file TL masing-masing team
// - Jeda 5 menit antar grup
// ============================================================
function waEvaluasiBulananAgen_DAN_SIMPAN() {
  const SLEEP_MS = 5 * 60 * 1000; // 5 menit

  const today        = new Date();
  const month        = today.getMonth() - 1;
  const startOfMonth = new Date(today.getFullYear(), month, 1, 0, 0, 0);
  const endOfMonth   = new Date(today.getFullYear(), month + 1, 0, 23, 59, 59);
  const bulanKey     = Utilities.formatDate(startOfMonth, TZ, 'yyyy-MM');
  const bulanText    = Utilities.formatDate(startOfMonth, TZ, 'MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();

  // ── 1. Hitung stats per agen dari FORM_HARIAN_RAW bulan lalu ──
  const stats = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < startOfMonth || ts > endOfMonth) continue;

    const agen    = normName(raw[i][COL_RAW_AGEN]);
    const team    = raw[i][COL_RAW_TEAM];
    if (!agen || !team) continue;

    const fu      = Number(raw[i][COL_RAW_FU])      || 0;
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';
    const dayKey  = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');

    if (!stats[agen]) stats[agen] = { team, listing:0, deal:0, days: new Set(), buyerDays: new Set() };
    stats[agen].days.add(dayKey);
    stats[agen].listing += listing;
    if (fu > 0) stats[agen].buyerDays.add(dayKey);
    if (dealYes) stats[agen].deal += 1;
  }

  // ── 2. Hitung listing & closing bulanan per team ──
  const monthlyStats = {}; // key: team → { listing: 0, closing: 0 }
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < startOfMonth || ts > endOfMonth) continue;
    const team    = raw[i][COL_RAW_TEAM];
    if (!team) continue;
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';
    if (!monthlyStats[team]) monthlyStats[team] = { listing: 0, closing: 0 };
    monthlyStats[team].listing += listing;
    if (dealYes) monthlyStats[team].closing += 1;
  }

  // ── 3. Baca SCOREBOARD_AGEN untuk Agent_Category & FT_FLAG per team ──
  const sbSheet = ss.getSheetByName('SCOREBOARD_AGEN');
  if (!sbSheet) { Logger.log('⚠️ Sheet SCOREBOARD_AGEN tidak ditemukan'); return; }
  const sbData  = sbSheet.getDataRange().getValues();

  const sbPerTeam = {};
  for (let i = 1; i < sbData.length; i++) {
    const team   = sbData[i][COL_SB_TEAM];
    const cat    = (sbData[i][COL_SB_AGENT_CAT] || '').toString().trim();
    const ftFlag = (sbData[i][COL_SB_FT_FLAG]   || '').toString().trim();
    if (!team) continue;
    if (!sbPerTeam[team]) sbPerTeam[team] = {
      topPerformer: 0, performer: 0, developing: 0,
      starter: 0, inTraining: 0, attention: 0,
      elite: 0, priority: 0, ready: 0
    };
    const t = sbPerTeam[team];
    if      (cat === 'Top Performer')     t.topPerformer++;
    else if (cat === 'Performer')         t.performer++;
    else if (cat === 'Developing')        t.developing++;
    else if (cat === 'Starter')           t.starter++;
    else if (cat === 'In Training')       t.inTraining++;
    else if (cat.includes('Attention'))   t.attention++;

    if      (ftFlag.includes('ELITE'))    t.elite++;
    else if (ftFlag.includes('PRIORITY')) t.priority++;
    else if (ftFlag.includes('READY'))    t.ready++;
  }

  // ── 4. Simpan rekap per agen ke file TL ──
  const teamBuffer = {};
  for (let i = 1; i < agenSheet.length; i++) {
    const nama = agenSheet[i][COL_AGEN_NAMA];
    const team = agenSheet[i][COL_AGEN_TEAM];
    if (!nama || !team) continue;

    const key       = normName(nama);
    const d         = stats[key];
    const hariAktif = d ? d.days.size      : 0;
    const listing   = d ? d.listing        : 0;
    const buyerAktif= d ? d.buyerDays.size : 0;
    const deal      = d ? d.deal           : 0;

    let status = 'NONACTIVE';
    let badge  = '-';
    if (hariAktif >= 16)     { status = 'ACTIVE';    badge = '⭐⭐⭐'; }
    else if (hariAktif >= 5) { status = 'POTENSIAL'; }

    if (!teamBuffer[team]) teamBuffer[team] = [];
    teamBuffer[team].push([nama, status, listing, buyerAktif, deal, badge]);
  }

  Object.entries(teamBuffer).forEach(([team, rows]) => {
    const fileId = TEAM_FILES[team];
    if (!fileId) return;
    const ssTL  = SpreadsheetApp.openById(fileId);
    const sName = 'REKAP_AGEN_' + bulanKey;
    let sh      = ssTL.getSheetByName(sName);
    if (!sh) {
      sh = ssTL.insertSheet(sName);
      sh.appendRow(['Nama Agen','Status','Listing','Buyer Aktif','Deal','Badge']);
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    Logger.log('[SIMPAN] ' + team + ' → ' + rows.length + ' baris ke ' + sName);
  });

  // ── 5. Kirim WA ke group TL per team dengan jeda 5 menit ──
  const groupData = ss.getSheetByName('DATA_GROUP_TL').getDataRange().getValues();
  let sentCount   = 0;

  for (let i = 1; i < groupData.length; i++) {
    const team     = groupData[i][0];
    const groupId  = groupData[i][2];
    const isActive = groupData[i][3];
    if (!team || !groupId || isActive !== true) continue;

    const sb = sbPerTeam[team]    || { topPerformer:0, performer:0, developing:0, starter:0, inTraining:0, attention:0, elite:0, priority:0, ready:0 };
    const ms = monthlyStats[team] || { listing: 0, closing: 0 };

    const message =
`Selamat Pagi Team ${team} ☀️
Berikut update status member team bulan lalu (${bulanText}):
📊 Agent Category:
• Top Performer : ${sb.topPerformer} agen
• Performer     : ${sb.performer} agen
• Developing    : ${sb.developing} agen
• Starter       : ${sb.starter} agen
• In Training   : ${sb.inTraining} agen
• ⚠️ Attention  : ${sb.attention} agen
🎯 Fast Track Flag:
• 🏆 ELITE      : ${sb.elite} agen
• ⭐ PRIORITY   : ${sb.priority} agen
• ✅ READY      : ${sb.ready} agen
📈 Aktivitas Bulan Lalu:
• Jumlah Listing : ${ms.listing}
• Jumlah Closing : ${ms.closing}
Tetap semangat dan pertahankan performa terbaik! 💪
Mansion Citraland`;

    if (sentCount > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke grup: ' + team);
      Utilities.sleep(SLEEP_MS);
    }

    Logger.log('[KIRIM BULANAN] ' + team + ' → group: ' + groupId);
    kirimWA(groupId, message);
    sentCount++;
  }

  Logger.log('✅ EVALUASI BULANAN AGEN SELESAI | Terkirim: ' + sentCount + ' grup');
}

// ============================================================
// WA REKAP BULANAN KE TL
// ============================================================
function waRekapBulananTL() {
  const today = new Date();
  const month        = today.getMonth() - 1;
  const startOfMonth = new Date(today.getFullYear(), month, 1, 0, 0, 0);
  const endOfMonth   = new Date(today.getFullYear(), month + 1, 0, 23, 59, 59);
  const monthText    = Utilities.formatDate(startOfMonth, TZ, 'MMM yyyy');

  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const raw     = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const tlSheet = ss.getSheetByName('DATA_TL').getDataRange().getValues();

  const stats = {};
  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < startOfMonth || ts > endOfMonth) continue;

    const team = raw[i][COL_RAW_TEAM];
    const agen = normName(raw[i][COL_RAW_AGEN]);
    if (!team || !agen) continue;

    const fu      = Number(raw[i][COL_RAW_FU])      || 0;
    const visit   = Number(raw[i][COL_RAW_VISIT])   || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';    // FIX: bukan 8L ✅
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const iklan   = Number(raw[i][COL_RAW_IKLAN])   || 0;

    if (!stats[team]) stats[team] = { agen:{}, totalDeal:0, totalListing:0 };
    if (!stats[team].agen[agen]) stats[team].agen[agen] = { fu:0, visit:0, deal:0, listing:0, iklan:0 };

    const a = stats[team].agen[agen];
    a.fu      += fu;
    a.visit   += visit;
    a.listing += listing;
    a.iklan   += iklan;
    if (dealYes) { a.deal += 1; stats[team].totalDeal += 1; }
    stats[team].totalListing += listing;
  }

  const SLEEP_MS  = 5 * 60 * 1000; // 5 menit
  let   sentCount = 0;

  for (let i = 1; i < tlSheet.length; i++) {
    const team = tlSheet[i][COL_TL_TEAM];
    const waTL = tlSheet[i][COL_TL_WA_FIX];
    if (!team || !waTL || !stats[team]) continue;

    const agenData   = Object.entries(stats[team].agen).map(([nama, v]) => ({ nama, ...v }));
    const topFU      = [...agenData].sort((a, b) => b.fu - a.fu)[0]           || null;
    const topVisit   = [...agenData].sort((a, b) => b.visit - a.visit)[0]     || null;
    const topListing = [...agenData].sort((a, b) => b.listing - a.listing)[0] || null;
    const topIklan   = [...agenData].sort((a, b) => b.iklan - a.iklan)[0]     || null;
    const topDeal    = [...agenData].filter(a => a.deal > 0).sort((a, b) => b.deal - a.deal)[0] || null;

    const message =
`📊 Ringkasan Bulanan Team ${team}
Periode: ${monthText}
🔥 Top Aktif:
• Follow Up  : ${topFU?.nama || '-'} (${topFU?.fu || 0})
• Visit      : ${topVisit?.nama || '-'} (${topVisit?.visit || 0})
• Listing    : ${topListing?.nama || '-'} (${topListing?.listing || 0})
• Iklan      : ${topIklan?.nama || '-'} (${topIklan?.iklan || 0})
• Deal       : ${topDeal?.nama || '-'} (${topDeal?.deal || 0})
🏆 Top Producer:
• ${topDeal?.nama || '-'} (${topDeal?.deal || 0} Deal)
📈 Ringkasan Team:
• Total Deal    : ${stats[team].totalDeal}
• Total Listing : ${stats[team].totalListing}
(Sistem otomatis)`;

    if (sentCount > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke TL team: ' + team);
      Utilities.sleep(SLEEP_MS);
    }
    kirimWA(waTL, message);
    sentCount++;
  }
  Logger.log('✅ REKAP BULANAN TL SELESAI');
}

// ============================================================
// WA RANGKUMAN MINGGUAN AGEN KE OWNER
// ============================================================
function waRangkumanMingguanAgenKeOwner() {
  const WA_OWNERS = ['6282179997779', '6281330731973'];

  const today        = new Date();
  const day          = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const thisMonday   = new Date(today);
  thisMonday.setDate(today.getDate() + diffToMonday);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  lastMonday.setHours(0, 0, 0, 0);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  lastSunday.setHours(23, 59, 59, 999);

  const periodText =
    Utilities.formatDate(lastMonday, TZ, 'dd MMM') + ' – ' +
    Utilities.formatDate(lastSunday, TZ, 'dd MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const totalAgen = agenSheet.length - 1;

  const stats      = {};
  let totalFU      = 0;
  let totalIklan   = 0;
  let totalListing = 0;

  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < lastMonday || ts > lastSunday) continue;

    const agen = normName(raw[i][COL_RAW_AGEN]);
    if (!agen) continue;

    const fu      = Number(raw[i][COL_RAW_FU])      || 0;
    const iklan   = Number(raw[i][COL_RAW_IKLAN])   || 0;
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const dayKey  = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');

    if (!stats[agen]) stats[agen] = { days: new Set() };
    stats[agen].days.add(dayKey);
    totalFU      += fu;
    totalIklan   += iklan;
    totalListing += listing;
  }

  let active    = 0;
  let potensial = 0;
  let nonactive = 0;
  Object.values(stats).forEach(v => {
    const d = v.days.size;
    if (d >= 4)      active++;
    else if (d >= 1) potensial++;
  });
  nonactive = totalAgen - active - potensial;

  // Update Master KPI DULU agar col 8/9/10 (ARRAYFORMULA) sudah terhitung
  updateMasterKPI();

  // Baca Master_KPI_Agent untuk breakdown FT per team
  const masterSheet = ss.getSheetByName('Master_KPI_Agent');
  const masterData  = masterSheet ? masterSheet.getDataRange().getValues() : [];
  const ftPerTeam   = {};  // key: team → { eligible: 0, total: 0 }
  for (let i = 1; i < masterData.length; i++) {
    const team     = masterData[i][COL_KPI_MASTER_TEAM];
    const ftStatus = (masterData[i][9] || '').toString();
    if (!team) continue;
    if (!ftPerTeam[team]) ftPerTeam[team] = { eligible: 0, total: 0 };
    ftPerTeam[team].total++;
    if (ftStatus.includes('FAST TRACK ELIGIBLE')) ftPerTeam[team].eligible++;
  }

  const ftBreakdown = Object.entries(ftPerTeam)
    .map(([team, v]) => '• ' + team + ' : ' + v.eligible + '/' + v.total + ' Eligible')
    .join('\n');

  const totalEligible = Object.values(ftPerTeam).reduce((s, v) => s + v.eligible, 0);

  const message =
`📊 Rangkuman Mingguan Aktivitas Agen
Periode: ${periodText}
Total Agen Terdaftar : ${totalAgen}
Status Agen:
• Active     : ${active}
• Potensial  : ${potensial}
• NonActive  : ${nonactive}
Aktivitas Mingguan:
• Follow Up  : ${totalFU}
• Iklan      : ${totalIklan}
• Listing    : ${totalListing}
🎯 Fast Track per Team:
${ftBreakdown}
Total FT Eligible    : ${totalEligible} agen
Catatan:
Fokus minggu ini pada konversi follow up & listing menuju closing.
(Sistem otomatis Mansion Properti)`;

  WA_OWNERS.forEach((wa, idx) => {
    if (idx > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke Owner berikutnya');
      Utilities.sleep(5 * 60 * 1000);
    }
    kirimWA(wa, message);
  });
  Logger.log('✅ RANGKUMAN MINGGUAN OWNER SELESAI');
}

// ============================================================
// WA REKAP BULANAN KE OWNER
// ============================================================
function waRekapBulananOwner() {
  const WA_OWNERS    = ['6282179997779', '6281330731973'];
  const today        = new Date();
  const month        = today.getMonth() - 1;
  const startOfMonth = new Date(today.getFullYear(), month, 1, 0, 0, 0);
  const endOfMonth   = new Date(today.getFullYear(), month + 1, 0, 23, 59, 59);
  const monthText    = Utilities.formatDate(startOfMonth, TZ, 'MMM yyyy');

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const raw       = ss.getSheetByName('FORM_HARIAN_RAW').getDataRange().getValues();
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();

  const teamStats   = {};
  const agenCounter = {};

  for (let i = 1; i < raw.length; i++) {
    const ts = raw[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    if (ts < startOfMonth || ts > endOfMonth) continue;

    const team = raw[i][COL_RAW_TEAM];
    const agen = normName(raw[i][COL_RAW_AGEN]);
    if (!team || !agen) continue;

    const fu      = Number(raw[i][COL_RAW_FU])      || 0;
    const dealYes = raw[i][COL_RAW_DEAL] === 'Ya';    // FIX: bukan 8L ✅
    const listing = Number(raw[i][COL_RAW_LISTING]) || 0;
    const dayKey  = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');

    if (!teamStats[team])   teamStats[team]   = { deal:0, listing:0 };
    if (!agenCounter[agen]) agenCounter[agen] = { days: new Set(), fu:0, deal:0 };

    agenCounter[agen].days.add(dayKey);
    agenCounter[agen].fu += fu;
    if (dealYes) {
      agenCounter[agen].deal += 1;
      teamStats[team].deal   += 1;
    }
    teamStats[team].listing += listing;
  }

  const totalAgen    = agenSheet.length - 1;
  const totalTeam    = Object.keys(teamStats).length;
  const agenValues   = Object.values(agenCounter);
  const activeAgen   = agenValues.filter(a => a.days.size >= 16).length;
  const avgCompliance = totalAgen
    ? Math.round(agenValues.reduce((s, a) => s + a.days.size, 0) / (totalAgen * 20) * 100)
    : 0;

  const agenWithDeal = Object.entries(agenCounter).filter(([_, v]) => v.deal > 0);
  const topProduser  = agenWithDeal.length ? agenWithDeal.sort((a, b) => b[1].deal - a[1].deal)[0] : null;
  const agenWithFU   = Object.entries(agenCounter).filter(([_, v]) => v.fu > 0);
  const topAktif     = agenWithFU.length   ? agenWithFU.sort((a, b) => b[1].fu - a[1].fu)[0]     : null;

  const teamLines   = Object.entries(teamStats).map(([t, v]) => '• ' + t + ' → ' + v.deal + ' Deal | ' + v.listing + ' Listing').join('\n');
  const totalDeal   = Object.values(teamStats).reduce((s, v) => s + v.deal, 0);
  const totalListing= Object.values(teamStats).reduce((s, v) => s + v.listing, 0);

  const message =
`📊 Laporan Bulanan Mansion Properti
Periode: ${monthText}
Total Team Aktif        : ${totalTeam} Team
Total Agen Terdaftar   : ${totalAgen} Agen
Agen Aktif (≥16hr/bln) : ${activeAgen} Agen
Rata-rata Kepatuhan    : ${avgCompliance}%
📈 Kinerja Bulan Ini:
• Total Deal    : ${totalDeal}
• Total Listing : ${totalListing}
🏆 Performa Team:
${teamLines}
⭐ Top Kontributor:
• Top Produser      : ${topProduser ? topProduser[0] + ' (' + topProduser[1].deal + ' Deal)' : '-'}
• Agen Paling Aktif : ${topAktif   ? topAktif[0]   + ' (' + topAktif[1].fu   + ' FU)'   : '-'}
📝 Catatan:
• Fokus peningkatan kepatuhan
• Optimalkan team dengan performa tertinggi
(Sistem otomatis)`;

  WA_OWNERS.forEach((wa, idx) => {
    if (idx > 0) {
      Logger.log('[SLEEP] Jeda 5 menit sebelum kirim ke Owner berikutnya');
      Utilities.sleep(5 * 60 * 1000);
    }
    kirimWA(wa, message);
  });
  Logger.log('✅ REKAP BULANAN OWNER SELESAI');
}

// ============================================================
// CEK AGEN TIDAK INPUT 2 HARI — kirim email ke TL
// ============================================================
function cekAgenTidakInput() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet  = ss.getSheetByName('FORM_HARIAN_RAW');
  const data      = rawSheet.getDataRange().getValues();
  const today     = new Date();
  const limitDate = new Date(today);
  limitDate.setDate(today.getDate() - 2);
  limitDate.setHours(0, 0, 0, 0);

  const lastInput = {};
  for (let i = 1; i < data.length; i++) {
    const ts  = data[i][COL_RAW_TIMESTAMP];
    if (!(ts instanceof Date)) continue;
    const agen = data[i][COL_RAW_AGEN];
    const team = data[i][COL_RAW_TEAM];
    if (!agen || !team) continue;
    if (!lastInput[team]) lastInput[team] = {};
    if (!lastInput[team][agen] || ts > lastInput[team][agen]) {
      lastInput[team][agen] = ts;
    }
  }

  const tlData = ss.getSheetByName('DATA_TL').getDataRange().getValues();
  for (let i = 1; i < tlData.length; i++) {
    const team  = tlData[i][COL_TL_TEAM];
    const email = tlData[i][COL_TL_WA];   // FIX: uncomment → pakai kolom No_WA sebagai email/WA ✅
    if (!team || !email || !lastInput[team]) continue;

    const list = [];
    Object.keys(lastInput[team]).forEach(agen => {
      if (lastInput[team][agen] < limitDate) list.push('- ' + agen);
    });

    if (list.length > 0) {
      try {
        MailApp.sendEmail({
          to     : email,
          subject: '⚠️ Agen ' + team + ' tidak input 2 hari',
          body   : 'Agen berikut tidak mengisi form aktivitas 2 hari terakhir:\n\n' + list.join('\n')
        });
      } catch (err) {
        Logger.log('Gagal kirim email TL ' + team + ': ' + err.toString());
      }
    }
  }
  Logger.log('✅ CEK AGEN TIDAK INPUT SELESAI');
}

// ============================================================
// APPLY TABLE STYLE NAVY KE FILE TL
// ============================================================
function applyTableStyleNavyTLFiles() {
  const HEADER_BG   = '#1f3a5f';
  const HEADER_TEXT = '#ffffff';
  const ROW_ODD     = '#ffffff';
  const ROW_EVEN    = '#f1f5fb';

  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss = SpreadsheetApp.openById(fileId);
    ss.getSheets().forEach(sh => {
      const name = sh.getName();
      if (!/^\d{4}-\d{2}$/.test(name)) return;
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 1 || lastCol === 0) return;

      sh.setFrozenRows(1);
      if (!sh.getFilter()) sh.getRange(1, 1, lastRow, lastCol).createFilter();

      sh.getRange(1, 1, 1, lastCol)
        .setBackground(HEADER_BG).setFontColor(HEADER_TEXT)
        .setWrap(true).setVerticalAlignment('middle')
        .setHorizontalAlignment('center').setFontWeight('bold');

      if (lastRow > 1) {
        sh.getRange(2, 1, lastRow - 1, lastCol).setBackground(ROW_ODD);
        for (let r = 3; r <= lastRow; r += 2) {
          sh.getRange(r, 1, 1, lastCol).setBackground(ROW_EVEN);
        }
      }

      sh.getRange(1, 1, lastRow, lastCol).setBorder(true, true, true, true, true, true);
      Logger.log('[NAVY TABLE OK] ' + team + ' → ' + name);
    });
  });
  Logger.log('✅ TABLE STYLE NAVY BLUE SELESAI');
}

// ============================================================
// MIGRASI DATA — UTILITY (jalankan sekali saja)
// ============================================================
function migrate1970to202601_SAFE() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATION_1970_DONE') === 'YES') {
    Logger.log('⛔ Migrasi sudah pernah dijalankan. DIBATALKAN.');
    return;
  }

  const SOURCE_SHEET  = '1970-01';
  const TARGET_SHEET  = '2026-01';
  const LEGACY_PREFIX = 'LEGACY_MIGRATED_';
  let totalMoved      = 0;

  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss  = SpreadsheetApp.openById(fileId);
    const src = ss.getSheetByName(SOURCE_SHEET);
    if (!src) { Logger.log('[SKIP] ' + team + ' → sheet tidak ada'); return; }

    const srcData = src.getDataRange().getValues();
    if (srcData.length <= 1) { Logger.log('[SKIP] ' + team + ' → kosong'); return; }

    let tgt = ss.getSheetByName(TARGET_SHEET);
    if (!tgt) { tgt = ss.insertSheet(TARGET_SHEET); tgt.appendRow(srcData[0]); }

    const headerSrc = JSON.stringify(srcData[0]);
    const headerTgt = JSON.stringify(tgt.getRange(1, 1, 1, tgt.getLastColumn()).getValues()[0]);
    if (headerSrc !== headerTgt) throw new Error('❌ HEADER TIDAK SAMA di team ' + team);

    const rows = srcData.slice(1);
    tgt.getRange(tgt.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    totalMoved += rows.length;

    src.setName(LEGACY_PREFIX + SOURCE_SHEET);
    src.hideSheet();
    Logger.log('[OK] ' + team + ' → ' + rows.length + ' row dimigrasikan');
  });

  props.setProperty('MIGRATION_1970_DONE', 'YES');
  props.setProperty('MIGRATION_1970_TOTAL_ROWS', totalMoved.toString());
  props.setProperty('MIGRATION_1970_TIMESTAMP', new Date().toISOString());
  Logger.log('✅ MIGRASI SELESAI | Total Row: ' + totalMoved);
}

function migrateJanTo202601_FORCE() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATION_JAN_2026_DONE') === 'YES') {
    Logger.log('⛔ Migrasi Jan → 2026-01 sudah pernah dijalankan.');
    return;
  }

  const SOURCE_SHEET = 'Jan';
  const TARGET_SHEET = '2026-01';
  const CUT_OFF_DATE = new Date('2026-01-24T00:00:00');
  let totalMoved     = 0;

  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss  = SpreadsheetApp.openById(fileId);
    const src = ss.getSheetByName(SOURCE_SHEET);
    if (!src) return;

    const srcData = src.getDataRange().getValues();
    if (srcData.length <= 1) { ss.deleteSheet(src); return; }

    const header = srcData[0];
    const rows   = srcData.slice(1).filter(r => r[0] instanceof Date && r[0] < CUT_OFF_DATE);
    if (rows.length === 0) { ss.deleteSheet(src); return; }

    let tgt = ss.getSheetByName(TARGET_SHEET);
    if (!tgt) { tgt = ss.insertSheet(TARGET_SHEET); tgt.appendRow(header); }

    tgt.getRange(tgt.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    totalMoved += rows.length;
    ss.deleteSheet(src);
    Logger.log('[OK] ' + team + ' → ' + rows.length + ' row dipindahkan');
  });

  props.setProperty('MIGRATION_JAN_2026_DONE', 'YES');
  props.setProperty('MIGRATION_JAN_TOTAL_ROWS', totalMoved.toString());
  props.setProperty('MIGRATION_JAN_TIMESTAMP', new Date().toISOString());
  Logger.log('✅ MIGRASI JAN FORCE SELESAI | Total Row: ' + totalMoved);
}

function sortSheet202601ByTimestamp() {
  const TARGET_SHEET = '2026-01';
  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss = SpreadsheetApp.openById(fileId);
    const sh = ss.getSheetByName(TARGET_SHEET);
    if (!sh) { Logger.log('[SKIP] ' + team + ' → sheet tidak ada'); return; }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= 2) { Logger.log('[SKIP] ' + team + ' → data terlalu sedikit'); return; }

    // COL_RAW_TIMESTAMP = 0 → kolom 1 (1-based)
    sh.getRange(2, 1, lastRow - 1, lastCol).sort({ column: COL_RAW_TIMESTAMP + 1, ascending: true });
    Logger.log('[OK] ' + team + ' → diurutkan');
  });
  Logger.log('✅ SORT SELESAI');
}

function fixWrongMonthEntry() {
  const SOURCE_SHEET = '2026-01';
  const TARGET_SHEET = '2026-02';
  const START_FEB    = new Date(2026, 1, 1, 0, 0, 0);
  const END_FEB      = new Date(2026, 2, 0, 23, 59, 59); // hari terakhir Feb (dinamis)

  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    const ss  = SpreadsheetApp.openById(fileId);
    const src = ss.getSheetByName(SOURCE_SHEET);
    if (!src) return;

    const data = src.getDataRange().getValues();
    if (data.length <= 1) return;

    const header = data[0];
    const rows   = data.slice(1);
    const toMove = [];
    const toKeep = [];

    rows.forEach(r => {
      const ts = r[COL_RAW_TIMESTAMP];
      if (ts instanceof Date && ts >= START_FEB && ts <= END_FEB) toMove.push(r);
      else toKeep.push(r);
    });

    if (toMove.length === 0) { Logger.log('[OK] ' + team + ' → tidak ada data nyelonong'); return; }

    let tgt = ss.getSheetByName(TARGET_SHEET);
    if (!tgt) { tgt = ss.insertSheet(TARGET_SHEET); tgt.appendRow(header); }

    tgt.getRange(tgt.getLastRow() + 1, 1, toMove.length, toMove[0].length).setValues(toMove);

    src.clearContents();
    src.getRange(1, 1, 1, header.length).setValues([header]);
    if (toKeep.length > 0) src.getRange(2, 1, toKeep.length, toKeep[0].length).setValues(toKeep);

    Logger.log('[FIXED] ' + team + ' → ' + toMove.length + ' row dipindahkan ke 2026-02');
  });
  Logger.log('✅ PERBAIKAN DATA NYELONONG SELESAI');
}

// ============================================================
// MAPPING KOLOM — KPI_Source
// Header (hasil QUERY): Agen | CRHot | Closing
// ============================================================
const COL_KPI_AGEN    = 0;
const COL_KPI_CRHOT   = 1;
const COL_KPI_CLOSING = 2;

// ============================================================
// MAPPING KOLOM — Master_KPI_Agent
// Header: Agent_ID | Nama Agen | Team | CR HOT | Closing | Score | Rank | Agent_Category | iFastTrack | FT_STATUS | FT_FLAG
// Col 8,9,10 → ARRAYFORMULA otomatis dari sheet, script hanya update col 0-6
// ============================================================
const COL_KPI_MASTER_ID       = 0;
const COL_KPI_MASTER_NAMA     = 1;
const COL_KPI_MASTER_TEAM     = 2;
const COL_KPI_MASTER_CRHOT    = 3;
const COL_KPI_MASTER_CLOSING  = 4;
const COL_KPI_MASTER_SCORE    = 5;
const COL_KPI_MASTER_RANK     = 6;
// Col 7 = Agent_Category → ARRAYFORMULA
// Col 8 = iFastTrack     → ARRAYFORMULA
// Col 9 = FT_STATUS      → ARRAYFORMULA
// Col 10= FT_FLAG        → ARRAYFORMULA

// ============================================================
// UPDATE MASTER KPI AGENT
// Flow: KPI_Source → hitung Score & Rank → update baris existing di Master_KPI_Agent
// Score = Closing * 100 + CRHot * 10  (sesuai formula col5 di sheet)
// Rank  = urutan Score tertinggi (overall semua agen)
// ============================================================
function updateMasterKPI() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Baca KPI_Source
  const kpiSheet = ss.getSheetByName('KPI_Source');
  if (!kpiSheet) { Logger.log('⚠️ Sheet KPI_Source tidak ditemukan'); return; }
  const kpiData = kpiSheet.getDataRange().getValues();
  if (kpiData.length <= 1) { Logger.log('⚠️ KPI_Source kosong'); return; }

  // 2. Baca DATA_AGEN untuk Agent_ID dan Team
  const agenSheet = ss.getSheetByName('DATA_AGEN').getDataRange().getValues();
  const agenMap   = {};  // key: normName(nama) → { id, team }
  for (let i = 1; i < agenSheet.length; i++) {
    const id   = agenSheet[i][COL_AGEN_ID];
    const nama = agenSheet[i][COL_AGEN_NAMA];
    const team = agenSheet[i][COL_AGEN_TEAM];
    if (!nama) continue;
    agenMap[normName(nama)] = { id, team };
  }

  // 3. Bangun data KPI per agen dari KPI_Source
  //    KPI_Source header: Agen | CRHot | Closing
  const kpiMap = {};  // key: normName(nama) → { nama, crHot, closing, score }
  for (let i = 1; i < kpiData.length; i++) {
    const nama    = kpiData[i][COL_KPI_AGEN];
    const crHot   = Number(kpiData[i][COL_KPI_CRHOT])   || 0;
    const closing = Number(kpiData[i][COL_KPI_CLOSING]) || 0;
    if (!nama) continue;
    // Rumus score sesuai formula col5: Closing*100 + CRHot*10
    const score   = closing * 100 + crHot * 10;
    kpiMap[normName(nama)] = { nama: nama.toString(), crHot, closing, score };
  }

  // 4. Hitung Rank berdasarkan Score tertinggi (overall semua agen)
  const sorted = Object.entries(kpiMap)
    .sort((a, b) => b[1].score - a[1].score);
  sorted.forEach(([key, _], idx) => {
    kpiMap[key].rank = idx + 1;
  });

  // 5. Baca Master_KPI_Agent — cari posisi baris per Nama Agen
  const masterSheet = ss.getSheetByName('Master_KPI_Agent');
  if (!masterSheet) { Logger.log('⚠️ Sheet Master_KPI_Agent tidak ditemukan'); return; }
  const masterData  = masterSheet.getDataRange().getValues();

  // Buat index: normName(nama) → row index (1-based di sheet)
  const masterIndex = {};
  for (let i = 1; i < masterData.length; i++) {
    const nama = masterData[i][COL_KPI_MASTER_NAMA];
    if (!nama) continue;
    masterIndex[normName(nama)] = i + 1;  // +1 karena getRange pakai 1-based
  }

  // 6. Update baris existing atau append jika agen belum ada di master
  let updatedCount = 0;
  let appendCount  = 0;

  Object.entries(kpiMap).forEach(([key, kpi]) => {
    const info    = agenMap[key] || {};
    const agentId = info.id   || '';
    const team    = info.team || '';
    const crHot   = kpi.crHot;
    const closing = kpi.closing;
    const score   = kpi.score;
    const rank    = kpi.rank;

    if (masterIndex[key]) {
      // UPDATE baris existing — hanya kolom 0-6 (col 8-10 dibiarkan, ARRAYFORMULA otomatis)
      const rowNum = masterIndex[key];
      masterSheet.getRange(rowNum, COL_KPI_MASTER_ID      + 1).setValue(agentId);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_NAMA    + 1).setValue(kpi.nama);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_TEAM    + 1).setValue(team);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_CRHOT   + 1).setValue(crHot);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_CLOSING + 1).setValue(closing);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_SCORE   + 1).setValue(score);
      masterSheet.getRange(rowNum, COL_KPI_MASTER_RANK    + 1).setValue(rank);
      updatedCount++;
    } else {
      // APPEND baris baru jika agen belum ada di master
      // Col 7-10 dikosongkan karena ARRAYFORMULA akan mengisi otomatis
      masterSheet.appendRow([agentId, kpi.nama, team, crHot, closing, score, rank, '', '', '', '']);
      appendCount++;
      Logger.log('[NEW] Agen baru ditambahkan ke Master_KPI_Agent: ' + kpi.nama);
    }
  });

  // 7. Update Rank semua baris yang sudah ada (termasuk agen tanpa data KPI minggu ini → rank kosong)
  //    Agen yang tidak ada di KPI_Source minggu ini tidak di-reset, datanya tetap
  Logger.log('✅ UPDATE MASTER KPI SELESAI | Updated: ' + updatedCount + ' | Appended: ' + appendCount);
}

// ============================================================
// REFRESH & TEST FUNCTIONS
// ============================================================
function refreshAllTL() {
  Object.entries(TEAM_FILES).forEach(([team, fileId]) => {
    try {
      const ss = SpreadsheetApp.openById(fileId);
      ss.toast('Checked by Master', team, 2);
    } catch (e) {
      Logger.log('Gagal buka ' + team + ': ' + e.message);
    }
  });
}

function testWAGrupTL() {
  const testTeam = 'Malang';
  const message  =
`🧪 Selamat Siang Team Malang, semoga hari ini lancar.
✅ Jangan Lupa isi Form Harian
✅ Accelerate FAST TRACK Menanti
✅ Closing Tinggal Menunggu Waktu
Tidak perlu dibalas 🙏
*Mansion Properti*`;
  sendWAToGroupByTeam(testTeam, message);
}

function debugWaTest() {
  Logger.log('CUT_OFF_AGENT: ' + CUT_OFF_AGENT);
  kirimWA('6281330731973', 'DEBUG WA TEST - jika masuk berarti fetch jalan');
}

function testKirimWA() {
  kirimWA('6281330731973', 'TEST WA REMINDER');
}