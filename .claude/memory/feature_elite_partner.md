---
name: Feature: ELITE Partner System
description: Rancangan lengkap fitur ELITE Partner — status, laporan transaksi, scheduler, WA notif, sidebar. SIAP CODING.
type: project
originSessionId: c3d2a2cf-f1eb-4bde-a6f6-7a6d568e89da
---
# ELITE Partner System — Rancangan Final (Siap Coding)

**Status:** Rancangan selesai, coding belum dimulai. Lanjut sesi berikutnya.

**Why:** Fitur baru untuk marketing tier ELITE dengan split komisi 70:30, kontrak 12 bulan, evaluasi kinerja kuartalan, dan laporan transaksi.

**How to apply:** Langsung mulai coding tanpa rancangan ulang. Urutan yang disarankan: (1) sheets.config.js, (2) server.js migrateHeaders, (3) backend routes + service, (4) scheduler, (5) frontend index.html.

---

## Sheet Baru

### ELITE_PROGRAM
ID, Agent_ID, Agen_Nama, Nama_Kantor, Tanggal_Mulai, Tanggal_Berakhir, Status (Aktif/Non_Aktif/Gugur_Expired/Gugur_Kinerja/Gugur_Manual), Form_E1_Verified, Form_E1_Catatan, Form_E1_Tgl, EQT_Nilai, EQT_Verified, EQT_Tgl, Kontrak_Verified, Kontrak_Tgl, Target_Kuartal_Nilai (default 3000000000), Target_Kuartal_Verified, Target_Kuartal_Tgl, Split_Sebelumnya, Alasan_NonAktif, Notif_60_Terkirim, Dibuat_Oleh, Dibuat_Pada, Diperbarui_Pada

### ELITE_TRANSACTIONS
ID (ELTRX-0001), Elite_Program_ID, Agent_ID, Agen_Nama, Tanggal, Bulan (YYYY-MM), Alamat_Transaksi, Tipe (Jual/Sewa), Co_Broke (TRUE/FALSE), Nilai_Transaksi, Komisi_Persen, Nilai_Komisi, **Nilai_Efektif** (Co_Broke=TRUE → Nilai_Transaksi×50%, FALSE → Nilai_Transaksi penuh), Dibuat_Pada, Diperbarui_Pada

### ELITE_CONTENT
Penjelasan_Program, Ketentuan_Program, Cara_Daftar, Updated_By, Updated_At (satu baris)

### Perubahan AGENTS
Tambah kolom: `Split_Komisi` (string: "60:40", "70:30", dll) + `Status_Elite` (string: "ELITE" atau kosong)

---

## Co-broke Rule
- Co_Broke = TRUE → Nilai_Efektif = Nilai_Transaksi × 50%
- Co_Broke = FALSE → Nilai_Efektif = Nilai_Transaksi
- Semua kalkulasi (rekapitulasi bulanan, evaluasi kinerja, ELITE Partner view) pakai Nilai_Efektif
- Tabel detail tampilkan keduanya: Nilai_Transaksi (asli) + Nilai_Efektif

---

## Logic Utama

### Aktivasi ELITE
1. Admin/principal buka Manajemen User → tombol [Grant ELITE]
2. Modal checklist: Form E-1 (verified+catatan), EQT (nilai+verified), Kontrak (verified), Target Kuartal (verified)
3. Bisa simpan draft partial
4. Semua 4 verified → tombol [Aktifkan ELITE] muncul
5. Klik aktifkan: snapshot Split_Komisi → Split_Sebelumnya, set Split_Komisi="70:30", Status_Elite="ELITE", buat ELITE_PROGRAM record, kirim WA Fonnte ke agen + principal

### Pencabutan Manual
Admin/principal → ELITE Partner → klik [Non Aktif] → input alasan → rollback Split_Komisi ke Split_Sebelumnya, Status_Elite="", WA ke agen + principal

### Scheduler Harian (cron-elite-check, 07:00 WIB)
- 60 hari sebelum Tanggal_Berakhir + Notif_60_Terkirim=FALSE → kirim WA, set flag TRUE
- today >= Tanggal_Berakhir → gugur expired, rollback split, WA

### Scheduler Bulanan (cron-elite-kinerja, tanggal 1 07:00 WIB)
- Evaluasi di bulan ke-3, 6, 9, 12 sejak Tanggal_Mulai
- Sum Nilai_Efektif 3 bulan terakhir
- < Target × 80% → gugur kinerja, rollback split, WA

### Renewal
- Buat record ELITE_PROGRAM baru (history lama tersimpan)
- Snapshot Split_Sebelumnya ulang dari nilai saat ini

---

## Routes

```
/api/v1/elite/
  GET    /agents              → list semua (admin/principal)
  GET    /agent/:agentId      → record aktif
  POST   /grant               → buat/update checklist
  PUT    /terminate/:id       → cabut manual + alasan
  GET    /content             → konten halaman (semua role)
  PUT    /content             → edit konten (admin/principal)

/api/v1/elite-transactions/
  GET    /:agentId            → semua TRX + rekapitulasi bulanan
  POST   /                    → tambah TRX (agen ELITE only)
  PUT    /:id                 → edit
  DELETE /:id                 → hapus

/api/v1/scheduler/
  POST   /elite-check         → expiry + 60-hari notif
  POST   /elite-kinerja       → evaluasi kinerja kuartalan
```

---

## Scheduler Jobs Baru di GCP
- `cron-elite-check` → `0 0 * * *` (00:00 UTC = 07:00 WIB) → POST /elite-check
- `cron-elite-kinerja` → `0 0 1 * *` (tiap tanggal 1) → POST /elite-kinerja

---

## Akses Kontrol
- Grant/Terminate ELITE: principal, admin
- ELITE Partner list + Total TRX: principal, admin
- Edit konten ELITE PARTNERSHIP: principal, admin
- Lihat halaman ELITE PARTNERSHIP: semua role
- Laporan Transaksi input+lihat: agen (hanya jika Status_Elite="ELITE")
- Edit Split_Komisi di Manajemen User: superadmin, admin, principal

---

## Frontend (index.html) — Yang Perlu Ditambah
1. Sidebar "ELITE PARTNERSHIP" → semua role → halaman read-only konten
2. Sidebar "ELITE Partner" → admin/principal → daftar agen ELITE + total TRX + tombol Non Aktif + sub-tab form konten
3. Manajemen User: badge ELITE di list agen, tombol [Grant ELITE], field Split_Komisi di form edit
4. Modal ELITE Checklist: 4 item verifikasi + draft + aktivasi
5. Halaman Laporan Transaksi: hanya untuk agen ELITE aktif — form input TRX + tabel detail + rekapitulasi per bulan
6. ELITE Partner view: Nama Agen | Kantor | Tgl Mulai | Tgl Berakhir | Sisa Hari | Total TRX 100% | 80% threshold | Status | [Non Aktif]

---

## File yang Diubah/Dibuat
- `backend/config/sheets.config.js` — tambah 3 sheet + kolom AGENTS
- `backend/server.js` — ensureSheet + migrateHeaders
- `backend/routes/elite.routes.js` — BARU
- `backend/routes/elite-transactions.routes.js` — BARU
- `backend/services/elite.service.js` — BARU (logic + Fonnte WA)
- `backend/routes/scheduler.routes.js` — tambah 2 endpoint
- `frontend/index.html` — sidebar, modal, halaman baru

## Estimasi Effort
4–6 jam total. Frontend index.html adalah bagian terberat.
