# PANDUAN PENGGUNAAN CRM — ROLE KOORDINATOR
**Mansion Realty | crm.mansionpro.id**
*Versi April 2026*

---

## DAFTAR ISI

1. [Login & Akses](#1-login--akses)
2. [Dashboard](#2-dashboard)
3. [Listing Properti](#3-listing-properti)
4. [Primary (Proyek Developer)](#4-primary-proyek-developer)
5. [Leads (Prospek)](#5-leads-prospek)
6. [Aktivitas Harian](#6-aktivitas-harian)
7. [Member Kantor](#7-member-kantor)
8. [Personal Assistant & ViGen](#8-personal-assistant--vigen)
9. [Pengaturan Profil](#9-pengaturan-profil)
10. [Share WA — Format Pesan](#10-share-wa--format-pesan)
11. [Web mansionpro.id — Profil Agen](#11-web-mansionproid--profil-agen)
12. [Batasan Role Koordinator](#12-batasan-role-koordinator)

---

## 1. LOGIN & AKSES

**URL CRM:** https://crm.mansionpro.id

### Cara Login
1. Buka `crm.mansionpro.id` di browser atau buka PWA (jika sudah diinstall)
2. Masukkan **Email** dan **Password** yang terdaftar
3. Klik **Masuk**

### Install sebagai PWA (Rekomendasi)
- **Android Chrome:** Tap menu (⋮) → *Add to Home screen*
- **iOS Safari:** Tap Share (□↑) → *Add to Home Screen*
- PWA memberikan pengalaman seperti aplikasi native, notifikasi lebih lancar

### Lupa Password
Hubungi Admin/Principal untuk reset password melalui menu **Edit User** di panel Admin.

---

## 2. DASHBOARD

Halaman pertama setelah login. Menampilkan ringkasan aktivitas Anda.

### Kartu Statistik Utama
| Kartu | Keterangan |
|---|---|
| **Total Listing** | Jumlah listing yang Anda buat |
| **Listing Aktif** | Listing dengan status Aktif |
| **Di Website** | Listing yang sudah dipublish ke mansionpro.id |
| **Total Leads** | Jumlah prospek yang Anda kelola |
| **Hot Leads** | Leads dengan skor tinggi / mendesak |
| **Deal Bulan Ini** | Closing yang berhasil bulan ini |

### Statistik Primary (Khusus Koordinator)
Di bagian bawah Dashboard, terdapat panel **⭐ Daftar Primary Aktif** yang menampilkan:
- **Total** proyek yang Anda koordinasi
- **Pending** — proyek menunggu approval Principal
- **Aktif** — sudah disetujui Principal
- **Publish** — sudah tayang di website

Klik nama proyek untuk langsung masuk ke detail proyek.

### Hot Leads (8 Teratas)
Menampilkan leads paling prioritas berdasarkan jadwal follow-up dan skor. Klik kartu lead untuk langsung update status.

### Notifikasi
Ikon lonceng (🔔) di pojok kanan atas. Notifikasi masuk untuk:
- Proyek Anda disetujui/ditolak Principal
- Ada lead baru yang cocok dengan listing Anda
- Update co-ownership listing

---

## 3. LISTING PROPERTI

Menu **Listing** di navigasi bawah. Tampil semua listing milik Anda.

### Membuat Listing Baru
1. Tap tombol **+ Tambah Listing** (pojok kanan atas)
2. Isi form:
   - **Judul** — nama listing (contoh: *Rumah 2 Lantai Hook Citraland*)
   - **Tipe Properti** — Rumah / Ruko / Apartemen / Gudang / Tanah
   - **Status Transaksi** — Jual / Sewa
   - **Harga** — angka tanpa titik/koma
   - **Lokasi** — Kecamatan & Kota
   - **Spesifikasi** — LT, LB, KT, KM, Sertifikat
   - **Deskripsi** — detail properti
   - **Kode Listing** — (opsional, auto-generate jika kosong)
3. Klik **Simpan**

### Menambah Foto
Setiap listing dapat memiliki **3 foto**:
- Tap kartu listing → **Edit**
- Scroll ke bagian Foto → tap area upload
- Foto otomatis dikompres sebelum diupload
- Untuk hapus foto: tap ikon 🗑️ pada foto

### Publish ke Website
1. Buka detail listing
2. Toggle **Tampilkan di Website** → ON
3. Listing akan muncul di **mansionpro.id/listings** dalam beberapa menit

### Share WA Listing
1. Buka detail listing
2. Tap tombol **Share WA** (ikon WhatsApp hijau)
3. Pilih **WhatsApp** atau **WA Business**
4. Pesan otomatis terisi dengan detail listing + info kontak Anda

Format pesan yang dikirim:
```
*JUDUL LISTING*
_Tipe - Status_

📍 *Lokasi* : ...
💰 *Harga* : ...
🏠 *Spek* : ...
🆔 *Kode* : ...

[Deskripsi singkat]

🔗 *Detail Lengkap:*
https://www.mansionpro.id/listings/...

*Hubungi Agen:*
👤 [Nama Agen]
🏢 Mansion [Nama Kantor]
📱 : +62...
💼 : +62... (WA Business)
🪪 Profil Agen: https://www.mansionpro.id/agents/nama-agen
```

### Generate Caption Sosmed
1. Buka detail listing → tab **Konten**
2. Tap **Generate Caption** untuk auto-generate dari data listing
3. Edit manual jika diperlukan → **Simpan ke Sheet**
4. Caption tersimpan ke Google Sheets dan bisa dipakai ulang

### Co-Ownership (Listing Bersama)
Jika listing serupa sudah ada di sistem:
- Sistem otomatis mendeteksi duplikat berdasarkan lokasi & harga
- Akan muncul notifikasi: *"Listing serupa ditemukan"*
- Anda bisa **Bergabung sebagai Co-Owner** untuk listing tersebut
- Listing co-owned tetap muncul di data Anda

---

## 4. PRIMARY (PROYEK DEVELOPER)

Menu **Primary** (ikon ⭐) di navigasi. Khusus untuk properti baru dari developer.

### Melihat Proyek
- Tab **Semua**: proyek yang sudah berstatus *Publish* (disetujui & dipublish admin)
- Tab **Milik Saya**: proyek yang Anda ajukan (semua status)

### Mengajukan Proyek Baru
1. Tap **+ Tambah Proyek**
2. Isi form:
   - **Nama Proyek** (wajib)
   - **Nama Developer** (wajib)
   - **Tipe Properti** (wajib)
   - Harga mulai, Cara Bayar, Deskripsi, Lokasi, Koordinat Maps
3. Tap **Ajukan Proyek**
4. Status awal: **Pending** ⏳ — menunggu approval Principal

**Alur Approval:**
```
Anda ajukan → Pending ⏳
     ↓
Principal review → Aktif ✅ (atau ditolak)
     ↓
Admin publish → Publish 🌐 (tayang di website)
```

### Edit Proyek
- Hanya proyek milik Anda (sebagai Koordinator) yang bisa diedit
- Tap kartu proyek → **Edit**
- Tidak bisa mengubah status Publish/Draft (hak Admin)

### Share WA Proyek
1. Buka detail proyek → tap **Share WA**
2. Pilih **WhatsApp** atau **WA Business**
3. Format pesan terisi otomatis dengan detail proyek + kontak Anda

### Statistik Hit Proyek
Di detail proyek milik Anda, ada tab **Statistik**:
- Lihat siapa saja agen yang sudah share proyek ini
- Jumlah share per agen per platform
- Waktu terakhir share

---

## 5. LEADS (PROSPEK)

Menu **Leads** di navigasi. Kelola semua prospek/calon pembeli Anda.

### Menambah Lead Baru
1. Tap **+ Tambah Lead**
2. Isi:
   - **Nama Prospek** (wajib)
   - **No. WhatsApp** — format: 628xxxxxxxx
   - **Sumber** — WA, Instagram, Referral, Website, dll
   - **Tipe Minat** — Beli / Sewa / Investasi / Konsultasi
   - **Budget** — range harga
   - **Tipe Properti** yang diminati
   - **Lokasi** yang diinginkan
3. Tap **Simpan**

### Update Status Lead
Status lead mengikuti pipeline berikut:
```
Baru → Dihubungi → Survey → Negosiasi → Closing → Deal
                                                  ↘ Batal
```
Tap lead → **Edit** → ubah **Status** → Simpan.

Saat pertama kali Anda mengubah status dari *Baru* ke lainnya, sistem otomatis mencatat **Tanggal Pertama Dihubungi**.

### Buyer Request
Jika prospek mencari properti spesifik yang belum ada di listing:
1. Buka lead → Edit → centang **Buyer Request** ✅
2. Notifikasi otomatis dikirim ke semua agen di sistem
3. Agen lain bisa membantu mencarikan properti yang sesuai

### Export Leads ke CSV
Di halaman Leads → tap **Export** → file CSV terunduh ke perangkat Anda.

### Smart Lead Matching
Saat Anda menambah listing baru dengan status *Aktif*, sistem otomatis:
- Mencocokkan dengan leads yang ada (berdasarkan budget, tipe, lokasi)
- Mengirim notifikasi ke agen yang punya leads cocok

---

## 6. AKTIVITAS HARIAN

Menu **Aktivitas** (ikon kalender). Log kegiatan harian Anda.

### Catat Aktivitas
1. Tap **+ Tambah Aktivitas**
2. Pilih tipe:
   - 📞 **Call** — telepon prospek/klien
   - 💬 **Follow-Up** — tindak lanjut leads
   - 🏠 **Visit** — survei properti
   - 🤝 **Meeting** — pertemuan klien
   - 📋 **Admin** — pekerjaan administratif
3. Isi catatan, lead terkait (opsional), tanggal & waktu
4. Tap **Simpan**

### Lihat Riwayat
- Filter berdasarkan tanggal atau minggu
- Hapus aktivitas jika salah catat

---

## 7. MEMBER KANTOR

Menu **Tim** → **Member Kantor**. Lihat struktur tim Mansion Realty.

- Daftar semua agen aktif dikelompokkan per kantor
- Lihat nama, role, jumlah listing, dan jumlah deal tiap anggota
- Gunakan kolom pencarian untuk cari nama tertentu
- **Hanya untuk melihat** — edit data anggota dilakukan oleh Admin

---

## 8. PERSONAL ASSISTANT & VIGEN

Menu **PA** (ikon robot 🤖). Fitur otomasi konten properti.

### Setup Kredensial
Sebelum menggunakan PA, simpan kredensial Anda:
1. Buka tab **Kredensial**
2. Isi:
   - **No. WA** untuk broadcast
   - **Instagram Username & Password** (untuk auto-post)
3. Tap **Simpan Kredensial**

> ⚠️ Kredensial dienkripsi dan hanya digunakan untuk keperluan otomasi Anda sendiri.

### Trigger PA (Otomasi Konten)
1. Pilih listing yang akan dipromosikan
2. Pilih tipe job:
   - **IG Reels** — video otomatis posting ke Instagram
   - **IG Story** — story otomatis
   - **WA Blast** — broadcast ke daftar kontak
3. Tap **Jalankan**
4. Monitor progress di tab **Log Aktivitas** (real-time)

### ViGen — Video Generator
Buat video properti otomatis dari data listing:
1. Buka detail listing
2. Tap **Generate Video** (ikon 🎬)
3. Sistem membuat video dari foto + data listing
4. Video siap diunduh atau langsung diposting via PA

### Zapier Integration
Untuk integrasi dengan tools eksternal:
1. Tab **Zapier** → **Generate Secret**
2. Gunakan secret key ini di Zapier webhook Anda

---

## 9. PENGATURAN PROFIL

Menu **Pengaturan** (ikon ⚙️). Kelola profil Anda.

### Update Profil
- **Nama** — nama yang tampil di pesan share WA
- **No. WhatsApp** — nomor yang tampil di pesan share
- **No. WA Business** — nomor WA Business (opsional, tampil jika diisi)
- **Nama Kantor** — otomatis tampil di pesan share sebagai `Mansion [Nama Kantor]`
- **Foto Profil** — upload foto (otomatis dikompresi)

> **Penting:** Nama Kantor di-set oleh Admin. Jika belum terisi, hubungi Admin untuk mengisi kolom `Nama_Kantor` di data Anda.

### Ganti Password
1. Tab **Keamanan**
2. Isi **Password Lama** → **Password Baru** → **Konfirmasi**
3. Tap **Ganti Password**

---

## 10. SHARE WA — FORMAT PESAN

Semua tombol Share WA (listing maupun proyek) menghasilkan format pesan standar Mansion Realty.

### Data yang Otomatis Diambil dari Profil Anda
| Field Profil | Tampil di Pesan Sebagai |
|---|---|
| `Nama` | `👤 [Nama Agen]` |
| `Nama_Kantor` | `🏢 Mansion [Nama Kantor]` |
| `No_WA` | `📱 : +62...` |
| `No_WA_Business` | `💼 : +62...` |
| URL Profil | `🪪 Profil Agen: mansionpro.id/agents/nama-agen` |

> **Catatan:** Pastikan semua data profil sudah diisi agar pesan share terlihat profesional.

### Pilihan Aplikasi WA
Setiap tombol Share WA menampilkan popup:
- **WhatsApp** — buka aplikasi WhatsApp biasa
- **WA Business** — buka WhatsApp Business (Android)

---

## 11. WEB MANSIONPRO.ID — PROFIL AGEN

Website publik: https://www.mansionpro.id

### Halaman Agen Anda
URL profil Anda: `https://www.mansionpro.id/agents/nama-anda`
*(contoh: mansionpro.id/agents/susanto-saputro)*

Halaman ini menampilkan:
- Foto profil & informasi dasar (nama, role, kota)
- Kredensial profesional (LSP, CRA jika ada)
- Statistik: Listing Aktif, Total Deal, Konversi, Skor Agen
- Semua listing aktif milik Anda
- Tombol Hubungi via WA

### Listing di Website
Listing Anda muncul di `mansionpro.id/listings` jika:
1. Status listing = **Aktif**
2. Toggle **Tampilkan di Website** = ON (di CRM)

### Halaman Proyek (Primary)
Proyek Anda muncul di `mansionpro.id/projects` jika:
- Status proyek = **Publish** (disetujui Principal + dipublish Admin)

### Halaman Tim Agen
Semua agen aktif tampil di `mansionpro.id/agents`.
- Klik kartu agen → masuk ke profil detail
- Foto profil, statistik, dan tombol WA tersedia di kartu

---

## 12. BATASAN ROLE KOORDINATOR

Berikut hal-hal yang **tidak bisa** dilakukan oleh Koordinator:

| Fitur | Siapa yang Bisa |
|---|---|
| Approve proyek Primary | Principal / Superadmin |
| Publish/Draft proyek ke website | Admin / Principal |
| Hapus proyek | Admin / Principal |
| Buat/edit/hapus akun agen | Admin |
| Lihat leads agen lain | Principal / Superadmin |
| Manajemen Tim | Business Manager / Principal |
| Laporan seluruh kantor | Admin / Principal |
| Force logout semua user | Superadmin |
| Lihat statistik hit semua proyek | Admin / Principal |

---

## TIPS & BEST PRACTICES

### Untuk Listing
✅ Selalu isi **semua spesifikasi** (LT, LB, KT, KM, Sertifikat) agar listing mudah ditemukan
✅ Upload minimal **1 foto utama** berkualitas baik sebelum publish ke website
✅ Generate **caption sosmed** agar konten siap pakai untuk IG/TikTok/Facebook
✅ Aktifkan **Tampilkan di Website** untuk listing yang sudah siap dipasarkan

### Untuk Leads
✅ Update status lead **segera setelah follow-up** agar pipeline selalu akurat
✅ Isi **detail budget dan preferensi** lengkap agar Smart Matching bekerja maksimal
✅ Tandai sebagai **Buyer Request** jika prospek perlu dicarikan properti khusus

### Untuk Primary
✅ Isi **deskripsi proyek selengkap mungkin** sebelum mengajukan ke Principal
✅ Pantau status di Dashboard → Primary Stats sampai berubah menjadi **Aktif**
✅ Setelah Publish, share ke WA menggunakan tombol **Share WA** di detail proyek

### Untuk Profil
✅ Pastikan **foto profil** sudah diupload (tampil di halaman agen website)
✅ Pastikan **No. WA** sudah benar (dipakai di semua pesan share otomatis)
✅ Minta Admin mengisi **Nama Kantor** jika belum terisi

---

## BANTUAN & KONTAK

Jika mengalami masalah teknis:
- Hubungi **Admin CRM** via WhatsApp kantor
- Laporkan bug ke tim IT Mansion Realty

**Jam Operasional Sistem:** 24/7 (otomatis)
**Maintenance rutin:** Setiap hari Minggu pukul 00.00–02.00 WIB

---

*Dokumen ini dibuat untuk internal Mansion Realty. Versi terbaru selalu tersedia di CRM.*
