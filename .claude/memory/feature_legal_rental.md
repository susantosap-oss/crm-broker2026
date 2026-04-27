---
name: Fitur Legal Dokumen + Reminder Sewa Otomatis
description: Rencana implementasi Manajemen Dokumen Legal (Google Drive) dan Sistem Reminder Sewa via WA/Notifikasi — belum dikerjakan
type: project
originSessionId: d356dbb1-e329-4914-90f0-f8e4813cf9fa
---
## Status: PLANNED — belum dikerjakan

**Why:** Permintaan user 2026-04-27. Kerjakan setelah fitur ViGen + IG Post selesai.
**How to apply:** Saat mulai implementasi, baca arsitektur di bawah sebagai panduan utama.

---

## Tech Stack CRM (penting untuk adaptasi)
- Backend  : Node.js / Express (bukan Next.js)
- Frontend : Vanilla JS SPA (bukan React)
- Database : Google Sheets SSoT (bukan SQL/Prisma)
- Storage  : Google Drive (dokumen) + Cloudinary (media)
- Notif    : Push Notification (sudah ada) + Fonnte/wa.me (sudah ada)
- Deploy   : Cloud Run (crm-broker2026 / crm-broker-properti / asia-southeast2)

---

## FITUR 1 — Manajemen Dokumen Legal (Google Drive API)

### Sheet baru: LEGAL_DOCS
```
A: ID              (UUID)
B: Agen_ID         (FK ke AGENTS)
C: Nama_File       (string)
D: Kategori        (PJB | Sewa | SPR | Lainnya)
E: Drive_File_ID   (Google Drive file ID)
F: Drive_URL       (link view publik)
G: Ukuran_KB       (number)
H: Uploaded_By     (agent_id admin yang upload)
I: Created_At
J: Catatan         (opsional)
```

### Backend: `backend/routes/legal.routes.js`
```
BASE: /api/v1/legal

POST /upload           — upload PDF ke Drive + simpan metadata ke LEGAL_DOCS
                         Body: multipart/form-data (file PDF + agent_id + kategori + catatan)
                         Role: admin | kantor | principal | superadmin
GET  /docs             — list dokumen milik agen login (atau semua jika admin)
                         Query: ?agent_id= (admin bisa lihat milik agen lain)
DELETE /docs/:id       — hapus dokumen (admin only) — hapus dari Drive + Sheets
```

### Backend: `backend/services/gdrive.service.js`
```javascript
// Google Drive API v3
// Service Account credentials dari env GOOGLE_SERVICE_ACCOUNT_JSON

async uploadPDF(buffer, filename, agentId, kategori) {
  // 1. Upload ke folder Drive per kategori: /CRM Legal/{kategori}/{agentId}/
  // 2. Set permission: reader untuk anyone with link
  // 3. Return { fileId, webViewLink }
}

async deleteFile(fileId) { ... }
```

### Env vars yang perlu ditambah:
```
GDRIVE_LEGAL_FOLDER_ID=   # ID folder root "CRM Legal" di Google Drive
```
Gunakan service account yang sama dengan Google Sheets (sudah ada credentials).

### Frontend: menu "Legal Perjanjian"
- Tambah tab/menu di sidebar agen
- Admin: form upload (pilih agen, kategori, drag-drop PDF)
- Agen: tabel list dokumen miliknya (Nama File, Kategori, Tanggal, tombol Buka)
- Link buka di tab baru via `Drive_URL`

---

## FITUR 2 — Status Sewa & Reminder Otomatis

### Sheet baru: RENTAL_STATUS
```
A: ID              (UUID)
B: Agen_ID         (FK ke AGENTS — agen yang handle)
C: Nama_Penyewa
D: Alamat_Sewa
E: Tanggal_Mulai   (ISO date)
F: Durasi_Bulan    (integer)
G: Tanggal_Selesai (calculated: Mulai + Durasi bulan, disimpan saat input)
H: Status          (aktif | selesai | diperpanjang | dibatalkan)
I: Reminder_90_Sent (TRUE/FALSE)
J: Reminder_30_Sent (TRUE/FALSE)
K: Catatan
L: Created_At
M: Updated_At
```

### Backend: `backend/routes/rental.routes.js`
```
BASE: /api/v1/rental

POST /                 — tambah data sewa baru
GET  /                 — list sewa milik agen login
PATCH /:id             — update status / perpanjang
DELETE /:id            — hapus data sewa
```

### Frontend: Modal Input Sewa
```javascript
// Hitung otomatis Tanggal_Selesai saat user isi Mulai + Durasi
function hitungTanggalSelesai(mulai, durasiBuilan) {
  const d = new Date(mulai);
  d.setMonth(d.getMonth() + durasiBuilan);
  return d.toLocaleDateString('id-ID'); // tampilkan real-time
}

// Event listener di input Tanggal Mulai dan Durasi
['rental-start', 'rental-duration'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const mulai    = document.getElementById('rental-start').value;
    const durasi   = parseInt(document.getElementById('rental-duration').value);
    if (mulai && durasi) {
      document.getElementById('rental-end-display').textContent = hitungTanggalSelesai(mulai, durasi);
    }
  });
});
```

### Backend: Cron Reminder Harian
Tambah ke `backend/services/cron.service.js` atau file terpisah `rental-reminder.service.js`:

```javascript
// Jalankan setiap hari pukul 08:00 WIB (01:00 UTC)
// Sudah ada node-cron di project

async function checkRentalReminders() {
  const rows  = await sheetsService.getRows(SHEETS.RENTAL_STATUS);
  const today = new Date();

  for (const row of rows) {
    if (row[7] !== 'aktif') continue; // hanya status aktif

    const endDate  = new Date(row[6]); // Tanggal_Selesai
    const diffDays = Math.round((endDate - today) / (1000 * 60 * 60 * 24));
    const agentId  = row[1];
    const agent    = await getAgentById(agentId); // dari AGENTS sheet

    // Reminder 90 hari
    if (diffDays === 90 && row[8] !== 'TRUE') {
      await kirimReminder(agent, row, diffDays, 'normal');
      await updateRow(rowIdx, { 8: 'TRUE' }); // tandai sudah dikirim
    }

    // Reminder 30 hari
    if (diffDays === 30 && row[9] !== 'TRUE') {
      await kirimReminder(agent, row, diffDays, 'urgent');
      await updateRow(rowIdx, { 9: 'TRUE' });
    }
  }
}

async function kirimReminder(agent, rentalRow, hariLagi, tone) {
  const nama_penyewa = rentalRow[2];
  const alamat       = rentalRow[3];
  const tgl_selesai  = new Date(rentalRow[6]).toLocaleDateString('id-ID');
  const nama_agen    = agent.Nama;
  const wa_agen      = agent.No_WA;

  const pesan = tone === 'urgent'
    ? `⚠️ *SEGERA* Halo ${nama_agen}, masa sewa *${nama_penyewa}* di ${alamat} akan berakhir dalam *${hariLagi} hari* (${tgl_selesai}). Segera hubungi penyewa untuk perpanjangan!`
    : `📋 Halo ${nama_agen}, masa sewa *${nama_penyewa}* di ${alamat} akan berakhir dalam ${hariLagi} hari (${tgl_selesai}). Silakan hubungi penyewa untuk proses perpanjangan.`;

  // Kirim WA via Fonnte (sudah ada di sistem)
  if (agent.Fonnte_Token && wa_agen) {
    await axios.post('https://api.fonnte.com/send', {
      target:  wa_agen.replace(/^0/, '62'),
      message: pesan,
    }, { headers: { Authorization: agent.Fonnte_Token } });
  }
  // Fallback: wa.me link (dibuka manual oleh sistem / agent)

  // Push notification in-app (sudah ada push.service.js)
  await pushService.sendToUser(agentId, {
    title: tone === 'urgent' ? '⚠️ Reminder Sewa Mendesak' : '📋 Reminder Sewa',
    body:  `Sewa ${nama_penyewa} berakhir ${hariLagi} hari lagi`,
    data:  { type: 'rental_reminder', rental_id: rentalRow[0] },
  });
}
```

---

## Urutan Implementasi yang Disarankan

1. **Sheet setup** — tambah tab LEGAL_DOCS + RENTAL_STATUS di Google Sheets
2. **sheets.config.js** — daftarkan kedua sheet + kolom-kolomnya
3. **Fitur 2 dulu (lebih simple):**
   - `rental.routes.js` + form modal frontend
   - Cron reminder di `cron.service.js`
4. **Fitur 1 sesudahnya:**
   - `gdrive.service.js` — butuh setup Drive folder + share permission
   - `legal.routes.js` + upload form admin + tabel agen

## Dependensi yang Perlu Ditambah
- `googleapis` sudah ada (dipakai Sheets) — Drive API tinggal enable
- `node-cron` sudah ada
- Fonnte sudah ada
- `multer` untuk handle upload PDF (cek apakah sudah ada)
