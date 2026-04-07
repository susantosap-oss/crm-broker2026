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
 * ROLES: superadmin | principal | business_manager | agen | admin | koordinator
 */

const NodeCache = require('node-cache');
const _sheetsCache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

const { google } = require('googleapis');

// ── Sheet Tab Names ────────────────────────────────────────
const SHEETS = {
  LISTING:           'LISTING',
  LEADS:             'LEADS',
  AGENTS:            'AGENTS',
  TEAMS:             'TEAMS',
  NOTIFICATIONS:     'NOTIFICATIONS',
  ACTIVITY_LOG:      'ACTIVITY_LOG',
  WA_QUEUE:          'WA_QUEUE',
  TASKS:             'TASKS',
  PIPELINE_STAGES:   'PIPELINE_STAGES',
  CONFIG:            'CONFIG',
  KOMISI_REQUEST:    'KOMISI_REQUEST',
  LAPORAN_HARIAN:    'LAPORAN_HARIAN',
  FAVOURITES:        'FAVOURITES',
  PROJECTS:          'PROJECTS',
  PROJECT_REFS:      'PROJECT_REFS',
  SHARE_LOG:         'SHARE_LOG',
  LISTING_AGENTS:    'LISTING_AGENTS',
  AKTIVITAS_HARIAN:  'AKTIVITAS_HARIAN',
  // ★ Fitur 2 — PA + ViGen + Meta Ads
  PA_CREDENTIALS:    'PA_CREDENTIALS',
  PA_JOBS:           'PA_JOBS',
  META_ADS_LOG:      'META_ADS_LOG',
  VIGEN_JOBS:        'VIGEN_JOBS',
  WEBHOOK_CONFIG:    'WEBHOOK_CONFIG',  // KV store konfigurasi webhook global
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
    'Keterangan',         // G
    'Minat_Tipe',         // H
    'Properti_Diminati',  // I
    'Budget_Min',         // J
    'Budget_Max',         // K
    'Lokasi_Preferred',   // L
    'Status_Lead',        // M
    'Agen_ID',            // N
    'Agen_Nama',          // O
    'Last_Contact',       // P
    'Next_Follow_Up',     // Q
    'Notes',              // R
    'Score',              // S
    'Created_At',         // T
    'Updated_At',         // U
    'Tipe_Properti',      // V
    'Jenis',              // W
    'Catatan',            // X
    'Last_Activity_Date', // Y
    'Catatan_Out',        // Z
    'Is_Buyer_Request',   // AA (TRUE/FALSE)
    'Team_ID',            // AB
    'Closing_Tipe',       // AC  Secondary | Primary
    'Closing_Listing_ID', // AD  ID listing sendiri (Secondary-own)
    'Closing_Listing_Nama', // AE  Nama listing untuk display
    'Closing_Cobroke',    // AF  Detail listing cobroke / brand lain
    'Closing_Proyek',     // AG  Nama proyek (Primary)
    'Tanggal_Dihubungi',  // AH  Timestamp pertama kali agen hubungi lead
  ],

  AGENTS: [
    'ID',                 // A
    'Nama',               // B
    'Email',              // C
    'Password_Hash',      // D
    'No_WA',              // E
    'Role',               // F  superadmin|principal|business_manager|agen|admin|kantor
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
    'Parent_Kantor',      // S  ★ Kantor induk (e.g. MANSION : Citraland untuk Malang)
    'Nomer_LSP',          // T  ★ Nomor Lembaga Sertifikasi Profesi
    'Aktivitas_Count',    // U  ★ Jumlah aktivitas harian (untuk scoring)
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
    'Koordinator_ID',    // U  ★ ID koordinator 1
    'Koordinator_Nama',  // V  ★ Nama koordinator 1
    'Status_Project',    // W  ★ Pending|Aktif|Nonaktif
    'Koordinator2_ID',   // X  ★ ID koordinator 2 (tandem)
    'Koordinator2_Nama', // Y  ★ Nama koordinator 2 (tandem)
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

  // ★ SHARE LOG — Log share/hit oleh agen
  SHARE_LOG: [
    'ID',             // A
    'Timestamp',      // B
    'Agen_ID',        // C
    'Agen_Nama',      // D
    'Tipe_Konten',    // E  listing | project
    'Konten_ID',      // F  ID listing atau project
    'Konten_Nama',    // G  Judul listing / Nama proyek
    'Platform',       // H  wa | wa_business | instagram | tiktok | facebook
    'Koordinator_ID', // I  ID koordinator proyek (kalau tipe=project)
  ],

  // ★ LISTING_AGENTS — Junction table: Co-Ownership listing
  LISTING_AGENTS: [
    'ID',           // A  UUID row
    'Listing_ID',   // B  FK ke LISTING
    'Agen_ID',      // C  FK ke AGENTS
    'Agen_Nama',    // D  denormalized
    'Role',         // E  'owner' | 'co_own'
    'Joined_At',    // F  ISO timestamp
    'Added_By',     // G  'system' (duplicate detection) | agent_id (principal reassign)
    'Notes',        // H  opsional: "Promoted from co_own by Principal [X]"
  ],

  // ★ AKTIVITAS HARIAN — Input harian agen
  AKTIVITAS_HARIAN: [
    'ID',           // A  UUID
    'Tanggal',      // B  YYYY-MM-DD
    'Agen_ID',      // C  FK ke AGENTS
    'Agen_Nama',    // D  denormalized
    'Deskripsi',    // E  teks aktivitas harian
    'Created_At',   // F  ISO timestamp
  ],

  // ★ PA_CREDENTIALS — Kredensial PA per agen (enkripsi AES-256)
  PA_CREDENTIALS: [
    'ID',               // A  UUID
    'Agen_ID',          // B  FK ke AGENTS
    'IG_Username',      // C  Username Instagram
    'IG_Password_Enc',  // D  Password IG (AES-256 encrypted)
    'WA_Number',        // E  Nomor WA untuk blast
    'PA_Enabled',       // F  TRUE/FALSE
    'IG_Session_GCS',   // G  Path GCS auth state IG
    'WA_Session_GCS',   // H  Path GCS auth state WA
    'Created_At',       // I
    'Updated_At',       // J
    'Last_IG_Login',    // K  Timestamp login IG terakhir berhasil
    'Last_WA_Login',    // L  Timestamp login WA terakhir berhasil
    'IG_Status',        // M  active|challenge_required|not_configured
    'WA_Status',        // N  active|qr_required|not_configured
    'Zapier_Secret',    // O  UUID per-agen untuk Zapier webhook auth
  ],

  // ★ PA_JOBS — Tracking semua job OpenClaw
  PA_JOBS: [
    'ID',               // A  Job ID (UUID)
    'Agen_ID',          // B
    'Agen_Nama',        // C
    'Type',             // D  ig_reels|ig_story|wa_blast
    'Status',           // E  queued|running|completed|failed
    'Listing_ID',       // F
    'Listing_Title',    // G
    'Video_URL',        // H
    'Recipients_JSON',  // I  JSON array (untuk wa_blast)
    'Session_Number',   // J  Sesi ke-berapa hari ini
    'Logs',             // K  Log summary (string)
    'Error_Msg',        // L
    'Created_At',       // M
    'Started_At',       // N
    'Finished_At',      // O
    'Triggered_By',     // P  agent_id yang trigger
  ],

  // ★ WEBHOOK_CONFIG — KV store konfigurasi webhook global (Meta vs Zapier)
  WEBHOOK_CONFIG: [
    'Key',          // A  e.g. webhook_type | meta_verify_token | zapier_secret | meta_page_access_token
    'Value',        // B
    'Updated_At',   // C
    'Updated_By',   // D  agent_id yang terakhir update
  ],

  // ★ META_ADS_LOG — Tracking iklan Meta per listing
  META_ADS_LOG: [
    'ID',               // A
    'Listing_ID',       // B
    'Listing_Title',    // C
    'Video_URL',        // D  URL Cloudinary
    'Meta_Video_ID',    // E
    'Creative_ID',      // F
    'Ad_ID',            // G
    'Form_ID',          // H
    'Status',           // I  pending|active|paused|deleted
    'Budget',           // J
    'Created_At',       // K
    'Created_By',       // L
  ],

  // ★ VIGEN_JOBS — Tracking render video dari my-video-app
  VIGEN_JOBS: [
    'ID',               // A  Job ID
    'Listing_ID',       // B
    'Listing_Title',    // C
    'Status',           // D  pending|rendering|done|failed
    'Video_URL',        // E  URL Cloudinary setelah selesai
    'Mood',             // F  minimalis|mewah
    'Duration_Target',  // G  15|30|60 (detik)
    'Requested_By',     // H  agent_id
    'Created_At',       // I
    'Finished_At',      // J
    'Error_Msg',        // K
    'Callback_Received',// L  TRUE/FALSE
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
  KANTOR:           'kantor',           // ★ Role kantor: privilege = principal, hidden dari member
  BUSINESS_MANAGER: 'business_manager',
  AGEN:             'agen',
  ADMIN:            'admin',
  KOORDINATOR:      'koordinator',
};

// Role levels untuk perbandingan hierarki
const ROLE_LEVEL = {
  superadmin:       5,
  principal:        4,
  kantor:           4,  // ★ Sama level dengan principal; penerima webhook Meta Ads
  business_manager: 3,
  admin:            2,
  agen:             1,
  koordinator:      1,  // sama dengan agen; hak tambahan ditambah eksplisit per route
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
