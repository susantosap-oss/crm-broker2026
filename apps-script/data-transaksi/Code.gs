// ═══════════════════════════════════════════════════════════════════════════
// SISTEM LAPORAN + ELITE STATUS — Data Transaksi Mansion
// Script ini melekat pada Spreadsheet "Data Transaksi Mansion"
// ID: 193lcLmru7ghRSz-ChZz8sTA7sNTL35a6BYgriaomUU4
//
// PERHATIAN: Fungsi asli (onOpen, onFormSubmit, onEdit, prosesUpdateLaporan,
// bersihkanLaporan, tarikDataKeLaporan, cetakKePDF, kirimNotifKeAdmin) tidak
// diubah logikanya — hanya onFormSubmit yang diperluas di bagian ELITE.
// ═══════════════════════════════════════════════════════════════════════════

// ─── KONFIGURASI ELITE ────────────────────────────────────────────────────
const CRM_SHEET_ID  = '1iHIGVPl7l7dDEVpqHGvZxFVIL8nqUx3G_skBPzFimzI';
const CACHE_TTL_SEC = 300; // 5 menit

/**
 * Tabel pemetaan nama tidak baku → nama resmi di sheet AGENTS CRM.
 * Kunci  : nama seperti yang diketik di form (huruf kecil semua).
 * Nilai  : nama persis seperti di kolom Nama sheet AGENTS (huruf besar-kecil bebas).
 * Tambahkan entri baru di sini setiap kali ada mismatch yang ditemukan.
 * Contoh :
 *   'susanto'        : 'Susanto Saputra',
 *   'dennis'         : 'Dennis Purwoko',
 *   'dennis / robert': 'Dennis Purwoko',
 */
const NAME_MAP = {
  // isi di sini
};

// ─── FUNGSI MENU (tidak berubah) ──────────────────────────────────────────
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 SISTEM LAPORAN')
      .addItem('Muat Data Manual (Cari E6)', 'tarikDataKeLaporan')
      .addSeparator()
      .addItem('Cetak ke PDF', 'cetakKePDF')
      .addSeparator()
      .addItem('🔄 Isi Ulang Status ELITE (Backfill)', 'backfillStatus')
      .addToUi();
}

// ─── 1. ON FORM SUBMIT (diperluas: tambah lookup ELITE di kolom P & Q) ────
function onFormSubmit(e) {
  var ss             = SpreadsheetApp.getActiveSpreadsheet();
  var sheetDataMasuk = ss.getSheetByName("Data_Masuk");

  // Mengambil data dari event form
  var values = e.values;

  // Kolom A dikosongkan untuk input Nomer Transaksi Manual nanti
  sheetDataMasuk.appendRow(["", ...values]);

  // === ELITE STATUS — tulis ke kolom P (16) & Q (17) ===
  // e.values: [0]=Timestamp, [1]=Tgl Transaksi, [2]=Jenis, [3]=Alamat,
  //           [4]=Harga, [5]=Status Transaksi, [6]=Persen Komisi,
  //           [7]=Nama Penjual, [8]=Agen Listing, [9]=Persen Listing,
  //           [10]=Nama Pembeli, [11]=Agen Selling, [12]=Persen Selling
  try {
    var newRow          = sheetDataMasuk.getLastRow();
    var tanggalStr      = values[1];   // Tanggal Transaksi
    var namaListing     = values[8];   // Nama Agen Listing
    var namaSelling     = values[11];  // Nama Agen Selling

    var statusMap       = getEliteStatusMap(tanggalStr);
    var statusListing   = resolveAgentStatus(namaListing, statusMap);
    var statusSelling   = resolveAgentStatus(namaSelling, statusMap);

    sheetDataMasuk.getRange(newRow, 16).setValue(statusListing); // P
    sheetDataMasuk.getRange(newRow, 17).setValue(statusSelling); // Q
  } catch (err) {
    // Non-fatal: catat di log, jangan blokir penyimpanan form
    console.log('[ELITE] onFormSubmit error: ' + err.message);
  }
}

// ─── 2. ON EDIT (tidak berubah) ───────────────────────────────────────────
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const ss    = e.source;

  const NAMA_SHEET_DATA    = "Data_Masuk";
  const KOLOM_STATUS_CETAK = 15; // Kolom O

  if (sheet.getName() !== NAMA_SHEET_DATA || range.getColumn() !== KOLOM_STATUS_CETAK) return;

  const statusCetak = range.getValue().toString().toUpperCase().trim();
  if (statusCetak !== "YA") return;

  const rowIdx = range.getRow();
  const rowData = sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (!rowData[0]) {
    range.setValue("PENDING");
    SpreadsheetApp.getUi().alert("⚠️ Nomer Transaksi di Kolom A masih kosong!");
    return;
  }

  try {
    prosesUpdateLaporan(ss, rowData);
    ss.toast("Berhasil memperbarui laporan No: " + rowData[0], "Selesai ✅");
  } catch (err) {
    SpreadsheetApp.getUi().alert("Terjadi kesalahan: " + err.message);
  }
}

// ─── 3. MESIN PROSES LAPORAN (tidak berubah) ─────────────────────────────
function prosesUpdateLaporan(ss, rowData) {
  const sheetCetak = ss.getSheetByName("Cetak_laporan");

  bersihkanLaporan();

  const hargaTransaksi = parseFloat(rowData[5]) || 0;

  const persenRaw = rowData[7].toString().replace("%", "").trim();
  const persenKomisiTotal = parseFloat(persenRaw) >= 1 ? parseFloat(persenRaw) / 100 : (parseFloat(persenRaw) || 0);

  const statusAgen = rowData[6].toString().toUpperCase();
  let faktor = 0;

  if (/LISTING.*SELL?ING|CO.*BROKE/.test(statusAgen)) {
    faktor = 0.5;
  } else if (/CO.*LISTING|CO.*SELLING/.test(statusAgen)) {
    faktor = 0.25;
  }

  const hasilKomisi = hargaTransaksi * persenKomisiTotal * faktor;

  sheetCetak.getRange("E7").setValue(rowData[0]);
  sheetCetak.getRange("E9").setValue(rowData[2]);
  sheetCetak.getRange("E12").setValue(rowData[4]);
  sheetCetak.getRange("E16").setValue(hargaTransaksi);

  const jenis = rowData[3].toString().toUpperCase();
  sheetCetak.getRange("E11").setValue(jenis.includes("JUAL")    ? "X" : "");
  sheetCetak.getRange("G11").setValue(jenis.includes("SEWA")    ? "X" : "");
  sheetCetak.getRange("I11").setValue(jenis.includes("PRIMARY") ? "X" : "");

  sheetCetak.getRange("E34").setValue(rowData[8]);
  sheetCetak.getRange("L34").setValue(rowData[11]);

  sheetCetak.getRange("E39").setValue(rowData[9]);
  sheetCetak.getRange("N39").setValue(rowData[12]);
  sheetCetak.getRange("E40").setValue(hasilKomisi);
  sheetCetak.getRange("N40").setValue(hasilKomisi);

  sheetCetak.getRange("P25").setValue(persenKomisiTotal);
  sheetCetak.getRange("B28").setValue(rowData[6]);

  // Tampilkan status ELITE di laporan (kolom P15 / sesuaikan posisi di template)
  if (rowData[15] || rowData[16]) {
    sheetCetak.getRange("B29").setValue(
      "Status: Listing=" + (rowData[15] || "-") + " | Selling=" + (rowData[16] || "-")
    );
  }

  ss.setActiveSheet(sheetCetak);
}

// ─── 4. FUNGSI PEMBERSIH (tidak berubah, ditambah B29) ───────────────────
function bersihkanLaporan() {
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var sheetCetak = ss.getSheetByName("Cetak_laporan");

  const ranges = ["E7:P10", "E12:P16", "E21:P26", "B28:P31", "D34:P37", "E39:P40", "E11", "G11", "I11"];
  ranges.forEach(r => sheetCetak.getRange(r).clearContent());
}

// ─── 5. TARIK DATA MANUAL (tidak berubah) ────────────────────────────────
function tarikDataKeLaporan() {
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var sheetCetak = ss.getSheetByName("Cetak_laporan");
  var sheetData  = ss.getSheetByName("Data_Masuk");

  var noTransDicari = sheetCetak.getRange("E6").getValue();
  if (!noTransDicari) {
    SpreadsheetApp.getUi().alert("Silakan ketik Nomer Transaksi di sel E6 terlebih dahulu.");
    return;
  }

  var data    = sheetData.getDataRange().getValues();
  var rowData = null;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString() == noTransDicari.toString()) {
      rowData = data[i];
      break;
    }
  }

  if (rowData) {
    prosesUpdateLaporan(ss, rowData);
    SpreadsheetApp.getUi().alert("Data ditemukan dan dimuat!");
  } else {
    SpreadsheetApp.getUi().alert("Nomer '" + noTransDicari + "' tidak ditemukan di Data_Masuk.");
  }
}

// ─── 6. CETAK PDF (tidak berubah) ─────────────────────────────────────────
function cetakKePDF() {
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var sheet      = ss.getSheetByName("Cetak_laporan");
  var ssId       = ss.getId();
  var sheetId    = sheet.getSheetId();
  var rangeCetak = "A1:P55";

  var url = "https://docs.google.com/spreadsheets/d/" + ssId + "/export" +
            "?format=pdf&size=A4&portrait=true" +
            "&scale=4&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3" +
            "&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false" +
            "&gid=" + sheetId + "&range=" + rangeCetak;

  var htmlContent = `<html><script>window.open("${url}", "_blank");setTimeout(function(){google.script.host.close();},500);</script>
                     <body style="font-family:sans-serif;text-align:center;padding-top:20px;"><p>Menyiapkan PDF...</p></body></html>`;

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(htmlContent).setWidth(300).setHeight(100),
    "Proses Cetak"
  );
}

// ─── 7. NOTIFIKASI EMAIL (tidak berubah) ─────────────────────────────────
function kirimNotifKeAdmin(e) {
  var emailAdmin = "admin.kantor@perusahaan.com";
  var jawaban    = e.namedValues;
  var subjek     = "Notifikasi: Input Baru Google Form";
  var isiPesan   = "Halo Admin,\n\nData baru masuk:\n------------------\n";
  for (var field in jawaban) { isiPesan += field + ": " + jawaban[field] + "\n"; }
  MailApp.sendEmail(emailAdmin, subjek, isiPesan);
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNGSI BARU: INTEGRASI ELITE STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Membaca AGENTS dan ELITE_PROGRAM dari CRM, lalu mengembalikan Map:
 *   { normalisasi_nama → 'ELITE' | 'REGULER' }
 * Status dihitung berdasarkan tanggalTransaksiStr (snapshot, bukan hari ini).
 * Hasilnya di-cache 5 menit di CacheService agar tidak membebani quota.
 */
function getEliteStatusMap(tanggalTransaksiStr) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'elite_data_v2';
  let   rawData;

  const cached = cache.get(cacheKey);
  if (cached) {
    rawData = JSON.parse(cached);
  } else {
    const crmSS  = SpreadsheetApp.openById(CRM_SHEET_ID);

    // Baca AGENTS: A=ID, B=Nama
    const agentsTab  = crmSS.getSheetByName('AGENTS');
    const agentsVals = agentsTab.getDataRange().getValues();
    const agents = agentsVals.slice(1)
      .map(r => ({ id: String(r[0]||'').trim(), nama: String(r[1]||'').trim() }))
      .filter(a => a.id && a.nama);

    // Baca ELITE_PROGRAM: B=Agent_ID, E=Tanggal_Mulai, F=Tanggal_Berakhir, G=Status
    const eliteTab  = crmSS.getSheetByName('ELITE_PROGRAM');
    const eliteVals = eliteTab.getDataRange().getValues();
    const programs = eliteVals.slice(1)
      .filter(r => String(r[1]||'').trim() && String(r[6]||'').trim() === 'Aktif')
      .map(r => ({
        agentId     : String(r[1]).trim(),
        tglMulai    : r[4] ? _toIso(r[4]) : null,
        tglBerakhir : r[5] ? _toIso(r[5]) : null,
      }));

    rawData = { agents, programs };
    cache.put(cacheKey, JSON.stringify(rawData), CACHE_TTL_SEC);
  }

  // Tanggal transaksi sebagai titik referensi
  const tglTrx = tanggalTransaksiStr ? new Date(tanggalTransaksiStr) : new Date();

  // Kumpulkan Agent_ID yang ELITE pada tanggal transaksi
  const eliteIds = new Set();
  rawData.programs.forEach(p => {
    const mulai   = p.tglMulai   ? new Date(p.tglMulai)   : null;
    const berakhir = p.tglBerakhir ? new Date(p.tglBerakhir) : null;
    const aktifPadaTanggal =
      (!mulai && !berakhir)                        ||  // tanpa batas waktu
      (mulai && !berakhir && tglTrx >= mulai)      ||  // open-ended
      (mulai && berakhir  && tglTrx >= mulai && tglTrx <= berakhir);
    if (aktifPadaTanggal) eliteIds.add(p.agentId);
  });

  // Buat map normNama → status
  const statusMap = {};
  rawData.agents.forEach(a => {
    statusMap[_norm(a.nama)] = eliteIds.has(a.id) ? 'ELITE' : 'REGULER';
  });
  return statusMap;
}

/**
 * Mencocokkan namaRaw ke statusMap, mengembalikan:
 *   'ELITE' | 'REGULER' | 'AGEN_LUAR' | 'TIDAK_DITEMUKAN'
 *
 * Prioritas:
 *   1. Kosong / "Agen Luar" / "Co-Broke"  → AGEN_LUAR
 *   2. NAME_MAP manual                     → lookup hasil pemetaan
 *   3. Exact match (case-insensitive)      → langsung
 *   4. Partial match: kata pertama cocok   → ambil hasil
 *   5. Tidak cocok                         → TIDAK_DITEMUKAN
 */
function resolveAgentStatus(namaRaw, statusMap) {
  if (!namaRaw) return 'AGEN_LUAR';
  const raw = namaRaw.toString().trim();
  if (!raw) return 'AGEN_LUAR';

  const lc = raw.toLowerCase();

  // Eksplisit agen luar
  if (/agen luar|co.?broke|luar|external|propnex|^xm$/i.test(raw)) return 'AGEN_LUAR';

  // NAME_MAP manual (admin isi)
  if (NAME_MAP[lc]) {
    const mapped = _norm(NAME_MAP[lc]);
    if (statusMap[mapped] !== undefined) return statusMap[mapped];
  }

  // Exact match
  const normRaw = _norm(raw);
  if (statusMap[normRaw] !== undefined) return statusMap[normRaw];

  // Partial: kata pertama nama CRM ada di nama form, atau sebaliknya
  for (const [normNama, status] of Object.entries(statusMap)) {
    const firstWordCRM  = normNama.split(' ')[0];
    const firstWordForm = normRaw.split(' ')[0];
    if (firstWordCRM  && firstWordCRM.length > 2  && normRaw.includes(firstWordCRM))  return status;
    if (firstWordForm && firstWordForm.length > 2 && normNama.includes(firstWordForm)) return status;
  }

  return 'TIDAK_DITEMUKAN';
}

/**
 * Mengisi kolom P & Q untuk semua baris Data_Masuk yang P-nya masih kosong.
 * Jalankan manual via menu "🔄 Isi Ulang Status ELITE (Backfill)".
 */
function backfillStatus() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheet   = ss.getSheetByName('Data_Masuk');
  const data    = sheet.getDataRange().getValues();
  if (data.length < 2) { ss.toast('Tidak ada data.'); return; }

  let updated = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Lewati jika kolom P sudah terisi
    if (row[15] && row[15].toString().trim()) { skipped++; continue; }
    // Lewati baris kosong
    if (!row[2] && !row[4]) { skipped++; continue; }

    try {
      const tanggalStr  = row[2]  ? row[2].toString()  : '';  // C = Tanggal Transaksi
      const namaListing = row[9]  ? row[9].toString()  : '';  // J = Agen Listing
      const namaSelling = row[12] ? row[12].toString() : '';  // M = Agen Selling

      const statusMap     = getEliteStatusMap(tanggalStr);
      const statusListing = resolveAgentStatus(namaListing, statusMap);
      const statusSelling = resolveAgentStatus(namaSelling, statusMap);

      sheet.getRange(i + 1, 16).setValue(statusListing); // P
      sheet.getRange(i + 1, 17).setValue(statusSelling); // Q
      updated++;

      // Throttle: jangan kena quota limit Apps Script
      if (updated % 20 === 0) Utilities.sleep(1000);
    } catch (err) {
      console.log('[ELITE] backfill row ' + (i + 1) + ' error: ' + err.message);
      skipped++;
    }
  }

  ss.toast('Backfill selesai: ' + updated + ' diperbarui, ' + skipped + ' dilewati.', 'ELITE Status ✅', 8);
}

/**
 * Pastikan header kolom P & Q sudah ada di baris 1 Data_Masuk.
 * Jalankan SEKALI secara manual sebelum menggunakan backfillStatus atau onFormSubmit.
 * Menu: dijalankan lewat Apps Script editor > Run > initEliteHeaders.
 */
function initEliteHeaders() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Data_Masuk');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (!headers[15] || headers[15].toString().trim() === '') {
    sheet.getRange(1, 16).setValue('Status Agen Listing');
  }
  if (!headers[16] || headers[16].toString().trim() === '') {
    sheet.getRange(1, 17).setValue('Status Agen Selling');
  }
  ss.toast('Header kolom P & Q siap.', 'Init ✅', 4);
}

/**
 * Hapus cache ELITE secara manual (misal setelah ada perubahan data ELITE_PROGRAM di CRM).
 * Tambahkan ke menu jika perlu.
 */
function clearEliteCache() {
  CacheService.getScriptCache().remove('elite_data_v2');
  SpreadsheetApp.getActiveSpreadsheet().toast('Cache ELITE dihapus. Data segar akan diambil saat submit berikutnya.', 'Cache', 5);
}

// ─── HELPER INTERNAL ──────────────────────────────────────────────────────

function _norm(str) {
  return str.toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

function _toIso(val) {
  if (val instanceof Date) return val.toISOString();
  return new Date(val).toISOString();
}
