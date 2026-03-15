/**
 * Google Sheets - Single Source of Truth (SSoT)
 * ============================================
 * SHEET TABS (10 tabs):
 *  1. LISTING          → Data properti utama
 *  2. LEADS            → Data calon pembeli/penyewa
 *  3. AGENTS           → Data agen & akun (5 role)
 *  4. TEAMS            → ★ Struktur tim
 *  5. NOTIFICATIONS    → ★ Notifikasi in-app
 *  6. ACTIVITY_LOG     → Log semua aktivitas CRM
 *  7. WA_QUEUE         → Antrean pesan WhatsApp
 *  8. TASKS            → Jadwal visit / meeting / follow-up
 *  9. PIPELINE_STAGES  → Definisi stage pipeline
 * 10. CONFIG           → Konfigurasi sistem
 *
 * ROLES: superadmin | principal | business_manager | agen | admin
 */

const NodeCache = require('node-cache');
const _sheetsCache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

const { google } = require('googleapis');

// ── Sheet Tab Names ────────────────────────────────────────
const SHEETS = {
  LISTING:         'LISTING',
  LEADS:           'LEADS',
  AGENTS:          'AGENTS',
  TEAMS:           'TEAMS',
  NOTIFICATIONS:   'NOTIFICATIONS',
  ACTIVITY_LOG:    'ACTIVITY_LOG',
  WA_QUEUE:        'WA_QUEUE',
  TASKS:           'TASKS',
  PIPELINE_STAGES: 'PIPELINE_STAGES',
  CONFIG:          'CONFIG',
  KOMISI_REQUEST:  'KOMISI_REQUEST',
  LAPORAN_HARIAN:  'LAPORAN_HARIAN',
  FAVOURITES:      'FAVOURITES',
  PROJECTS:      'PROJECTS',
  PROJECT_REFS:  'PROJECT_REFS',
};

// ── Column Definitions ─────────────────────────────────────
const COLUMNS = {

  LISTING: [
    'ID',                 // A
    'Tanggal_Input',      // B
    'Kode_Listing',       // C
    'Tipe_Properti',      // D
    'Status_Transaksi',   // E
    'Status_Listing',     // F
    'Judul',              // G
    'Deskripsi',          // H
    'Caption_Sosmed',     // I
    'Harga',              // J
    'Harga_Format',       // K
    'Harga_Permeter',     // K2 ★ Harga per m2
    'Harga_Permeter_Format', // K3 ★ Format harga per m2
    'Alamat',             // L
    'Kecamatan',          // M
    'Kota',               // N
    'Provinsi',           // O
    'Luas_Tanah',         // P
    'Luas_Bangunan',      // Q
    'Kamar_Tidur',        // R
    'Kamar_Mandi',        // S
    'Lantai',             // T
    'Garasi',             // U
    'Sertifikat',         // V
    'Kondisi',            // W
    'Fasilitas',          // X
    'Foto_Utama_URL',     // Y
    'Foto_2_URL',         // Z  ★ NEW
    'Foto_3_URL',         // AA ★ NEW
    'Foto_Gallery',       // AB
    'Cloudinary_IDs',     // AC
    'Agen_ID',            // AD
    'Agen_Nama',          // AE
    'Team_ID',            // AF ★ NEW
    'Koordinat_Lat',      // AG
    'Koordinat_Lng',      // AH
    'Maps_URL',           // AI
    'Tampilkan_di_Web',   // AJ
    'Featured',           // AK
    'Views_Count',        // AL
    'Created_At',         // AM
    'Updated_At',         // AN
    'Notes',              // AO
  ],

  LEADS: [
    'ID',                 // A
    'Tanggal',            // B
    'Nama',               // C
    'No_WA',              // D
    'Email',              // E
    'Sumber',             // F
    'Minat_Tipe',         // G
    'Properti_Diminati',  // H
    'Budget_Min',         // I
    'Budget_Max',         // J
    'Lokasi_Preferred',   // K
    'Status_Lead',        // L
    'Agen_ID',            // M
    'Agen_Nama',          // N
    'Last_Contact',       // O
    'Next_Follow_Up',     // P
    'Notes',              // Q
    'Score',              // R
    'Created_At',         // S
    'Updated_At',         // T
    'Tipe_Properti',      // U
    'Jenis',              // V
    'Catatan',            // W
    'Last_Activity_Date', // X
    'Catatan_Out',        // Y
    'Is_Buyer_Request',   // Z  ★ NEW (TRUE/FALSE)
    'Team_ID',            // AA ★ NEW
    'Closing_Tipe',       // AB  Secondary | Primary
    'Closing_Listing_ID', // AC  ID listing sendiri (Secondary-own)
    'Closing_Listing_Nama', // AD  Nama listing untuk display
    'Closing_Cobroke',    // AE  Detail listing cobroke / brand lain
    'Closing_Proyek',     // AF  Nama proyek (Primary)
    'Tanggal_Dihubungi',  // AG  ★ Timestamp pertama kali agen hubungi lead
  ],

  AGENTS: [
    'ID',                 // A
    'Nama',               // B
    'Email',              // C
    'Password_Hash',      // D
    'No_WA',              // E
    'Role',               // F  superadmin|principal|business_manager|agen|admin
    'Status',             // G
    'Foto_URL',           // H
    'Join_Date',          // I
    'Listing_Count',      // J
    'Deal_Count',         // K
    'Last_Login',         // L
    'Created_At',         // M
    'Telegram_ID',        // N
    'Team_ID',            // O  ★ NEW
    'Updated_At',         // P  ★ NEW
    'No_WA_Business',     // Q  ★ WA Business number
    'Nama_Kantor',        // R  ★ Nama kantor (format: MANSION : {nama})
  ],

  // ★ NEW SHEET
  TEAMS: [
    'Team_ID',            // A
    'Nama_Team',          // B
    'Principal_ID',       // C
    'Principal_Nama',     // D
    'BM_ID',              // E  Business Manager ID
    'BM_Nama',            // F
    'Member_IDs',         // G  JSON array of agen IDs
    'Member_Names',       // H  JSON array of agen names
    'Status',             // I  Aktif/Nonaktif
    'Created_At',         // J
    'Updated_At',         // K
  ],

  // ★ NEW SHEET
  NOTIFICATIONS: [
    'Notif_ID',           // A
    'Tipe',               // B  komisi_request|buyer_request|system|task_reminder
    'Judul',              // C
    'Pesan',              // D
    'From_User_ID',       // E
    'From_User_Nama',     // F
    'To_User_ID',         // G  kosong = broadcast ke role
    'To_Role',            // H  principal|business_manager|all
    'Is_Read',            // I  TRUE/FALSE
    'Created_At',         // J
    'Link_Type',          // K  lead|listing|task|komisi
    'Link_ID',            // L
  ],

  ACTIVITY_LOG: [
    'ID',
    'Timestamp',
    'Agen_ID',
    'Agen_Nama',
    'Action_Type',
    'Entity_Type',
    'Entity_ID',
    'Description',
    'IP_Address',
    'User_Agent',
  ],

  WA_QUEUE: [
    'ID',
    'Timestamp',
    'Lead_ID',
    'Lead_Nama',
    'No_WA',
    'Pesan',
    'Tipe',
    'Status',
    'Scheduled_At',
    'Sent_At',
    'Agen_ID',
    'Error_Log',
  ],

  TASKS: [
    'ID',
    'Kode_Task',
    'Tipe',
    'Judul',
    'Status',
    'Prioritas',
    'Lead_ID',
    'Lead_Nama',
    'Lead_No_WA',
    'Listing_ID',
    'Listing_Kode',
    'Listing_Judul',
    'Agen_ID',
    'Agen_Nama',
    'Scheduled_At',
    'Duration_Menit',
    'Lokasi',
    'Koordinat_Lat',
    'Koordinat_Lng',
    'Catatan_Pre',
    'Catatan_Post',
    'Reminder_At',
    'Reminder_Sent',
    'Completed_At',
    'Outcome',
    'Pipeline_Stage_Before',
    'Pipeline_Stage_After',
    'Created_By',
    'Created_At',
    'Updated_At',
    'Attachment_URLs',
  ],

  KOMISI_REQUEST: [
    'ID',             // A
    'Tanggal',        // B
    'Agen_ID',        // C
    'Agen_Nama',      // D
    'Agen_WA',        // E
    'Listing_ID',     // F
    'Listing_Judul',  // G
    'Harga_Deal',     // H
    'Komisi_Persen',  // I
    'Komisi_Nominal', // J
    'Catatan',        // K
    'Status',         // L  Pending|Diproses|Disetujui|Ditolak
    'Reviewed_By',    // M
    'Reviewed_At',    // N
    'Created_At',     // O
  ],

  LAPORAN_HARIAN: [
    'ID',             // A
    'Tanggal',        // B
    'Admin_ID',       // C
    'Admin_Nama',     // D
    'Isi_Laporan',    // E
    'Created_At',     // F
    'Updated_At',     // G
  ],

  FAVOURITES: [
    'ID',             // A
    'Agen_ID',        // B
    'Listing_ID',     // C
    'Created_At',     // D
  ],


  // ★ PRIMARY — Proyek Developer
  PROJECTS: [
    'ID',             // A
    'Tanggal_Input',  // B
    'Kode_Proyek',    // C
    'Nama_Proyek',    // D
    'Nama_Developer', // E
    'Tipe_Properti',  // F
    'Harga_Mulai',    // G
    'Harga_Format',   // H
    'Cara_Bayar',     // I
    'Deskripsi',      // J
    'Foto_1_URL',     // K
    'Foto_2_URL',     // L
    'Cloudinary_IDs', // M
    'Caption_Sosmed', // N
    'Status',         // O  Draft|Publish
    'Created_By_ID',  // P
    'Created_By_Nama',// Q
    'Created_At',     // R
    'Updated_At',     // S
    'Notes',          // T
  ],

  // ★ PRIMARY — Shortlink tracking per agen
  PROJECT_REFS: [
    'ID',           // A
    'Project_ID',   // B
    'Kode_Proyek',  // C
    'Agen_ID',      // D
    'Agen_Nama',    // E
    'Ref_Code',     // F
    'Short_URL',    // G
    'Click_Count',  // H
    'Last_Click_At',// I
    'Created_At',   // J
  ],

  PIPELINE_STAGES: [
    'Stage_ID',
    'Kode',
    'Nama',
    'Urutan',
    'Deskripsi',
    'Warna_Hex',
    'Icon_FA',
    'SLA_Hari',
    'Auto_Task_Tipe',
    'Is_Terminal',
    'Aktif',
    'Created_At',
  ],

};

// ── Role Hierarchy ─────────────────────────────────────────
const ROLES = {
  SUPERADMIN:       'superadmin',
  PRINCIPAL:        'principal',
  BUSINESS_MANAGER: 'business_manager',
  AGEN:             'agen',
  ADMIN:            'admin',
};

// Role levels untuk perbandingan hierarki
const ROLE_LEVEL = {
  superadmin:       5,
  principal:        4,
  business_manager: 3,
  admin:            2,
  agen:             1,
};

// ── Google Sheets Auth ─────────────────────────────────────
let _auth   = null;
let _sheets = null;

function getGoogleAuth() {
  if (_auth) return _auth;
  const privateKey  = process.env.GOOGLE_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (privateKey && clientEmail) {
    _auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    _auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return _auth;
}

function getSheetsClient() {
  if (_sheets) return _sheets;
  _sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  return _sheets;
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

module.exports = {
  SHEETS,
  COLUMNS,
  ROLES,
  ROLE_LEVEL,
  SPREADSHEET_ID,
  getGoogleAuth,
  getSheetsClient,
};
