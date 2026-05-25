# CRM Broker Properti — Development Roadmap

> **Last updated:** 2026-05-25
> **Versi aktif:** v1.9.9 · live di [crm.mansionpro.id](https://crm.mansionpro.id)
> **GCP:** project `crm-broker2026` · service `crm-broker-properti` · region `asia-southeast2`

---

## STATUS RINGKAS

| Fitur | Status | Versi |
|---|---|---|
| Core CRM (Listing, Leads, Agen, Tim) | ✅ Live | v1.0 |
| Aktivitas Harian + Role Kantor | ✅ Live | v1.3 |
| PA Digital Twin (OpenClaw) + ViGen | ✅ Live | v1.6 |
| Legal Dokumen + Status Sewa | ✅ Live | v1.8.7 |
| Buku Kontak WA (AES-256-GCM) | ✅ Live | v1.8 |
| SEO Bulk Title Generator | ✅ Live | v1.6.7 |
| Excel Export | ✅ Live | v1.8 |
| Payment Stages | ✅ Live | v1.8 |
| Canvasing | ✅ Live | v1.9.1 |
| Kalkulator (KPR + Appraisal + Investasi) | ✅ Live | v1.9.9 |
| Push Notifications (VAPID) | ✅ Live | v1.9 |
| Meta Ads — webhook infra + config | ✅ Live | v1.9 |
| Meta Ads — launch campaign | ⏳ Pending | — |
| Smart Lead Cascade (Cloud Tasks) | ⏳ Pending | — |
| Konversi Rate Agen (Leads_Count) | ⏳ Pending | — |

---

## FITUR SELESAI

### Core CRM ✅
- Listing (CRUD, foto Cloudinary, co-ownership, SEO title)
- Leads (Hot/Warm/Cold, pipeline, histori follow-up)
- Agen & Tim (role hierarchy: superadmin → principal → kantor → business_manager → admin → agen)
- Dashboard (ringkasan per role)
- Komisi Request + Laporan Harian
- Shortlink publik `/p/:id` untuk share listing

### PA Digital Twin + ViGen ✅
- PA credentials tersimpan terenkripsi (AES-256-GCM)
- Instagram/WA posting via OpenClaw service
- Video Engine (ViGen) — render listing video, polling job status tiap 2 menit
- PA Dashboard: log post, status job, tombol trigger per listing

### Legal & Transaksi ✅
- Legal Dokumen: upload/download via Cloudinary, per-listing
- Status Sewa: tracking kontrak aktif + reminder otomatis
- Payment Stages: tracking tahapan pembayaran per transaksi

### Kalkulator Properti ✅ (v1.9.9)
- **KPR:** Konvensional, Syariah, KMG, Take Over — cicilan, total kredit, biaya cash di depan
- **Appraisal:** valuasi properti berbasis NJOP + lokasi + kondisi
- **Investasi Properti:** Gross Yield, Net ROI Sewa, ROI Capital Gain — 5 jenis properti, standar industri, proyeksi tahunan
- PDF export fit-to-page 1 halaman (header auto dari data agen login)

---

## FITUR PENDING

### Meta Ads — Full Campaign Launch ⏳

**Pre-requisite yang masih disiapkan:**
- [ ] Instagram Kantor → convert ke **Business Account**
- [ ] Facebook Page terhubung ke Instagram Business
- [ ] Meta Business Manager aktif + Ad Account
- [ ] Meta App review (Marketing API + Lead Ads API) — estimasi 1–2 minggu setelah submit

**Sudah siap di backend:**
- Sheet `META_ADS_LOG`, `WEBHOOK_CONFIG` sudah ada
- Webhook endpoint `POST /api/v1/webhook/meta` sudah live
- Signature verification (X-Hub-Signature-256) sudah implementasi

**Yang masih perlu dikerjakan:**
1. Meta Ads API: upload video → buat creative → launch campaign
2. Parse Lead Form data dari Meta Graph API → auto-create Lead di CRM
3. Frontend: tombol "Promote to Meta Ads" (visible hanya principal/kantor)

---

### Smart Lead Cascade (30-menit timeout) ⏳

**Stack:** Google Cloud Tasks (sudah di ekosistem GCP)

**State Machine Secondary (Listing):**
```
[BARU] → Step 1: WA → Owner Listing ──── 30 mnt ──→ Step 2: CoOwner → Step 3: Principal
```

**State Machine Primary (Project):**
```
[BARU] → Step 1: Koordinator ── 30 mnt ─→ Step 2: Agen scoring tertinggi
       → Step 3: Business Manager → Step 4: Principal
```

**Sheet yang dibutuhkan:**
```
LEAD_NOTIFICATIONS: ID, Lead_ID, Step, Target_Agen_ID, Token,
                    Sent_At, Expires_At, Claimed_At, Status
```

---

### Konversi Rate Agen ⏳

- Tambah kolom `Leads_Count` di sheet AGENTS (kolom X)
- Dua formula konversi:
  - **Listing Agent:** (jumlah deal listing milik agen / Leads_Count) × 100%
  - **Selling Agent:** (jumlah deal closing oleh agen / Leads_Count) × 100%
- Tampil di profil agen + ranking leaderboard

---

## ARSITEKTUR SISTEM

```
Browser (PWA)
  ↕ REST API (/api/v1/*)
Backend — Node.js/Express (Cloud Run · asia-southeast2)
  ├── Google Sheets (SSoT — semua data)
  ├── Cloudinary (foto listing, legal docs, video)
  ├── OpenClaw (PA Digital Twin — Instagram/WA posting)
  ├── ViGen (Video Engine — render listing video)
  ├── Telegram Bot (notif internal)
  └── Web Push (VAPID — notif browser)
```

**Env vars kritis:**
```
GOOGLE_SHEETS_ID, CLOUDINARY_*, TELEGRAM_BOT_TOKEN,
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PA_ENCRYPTION_KEY,
VIGEN_URL, VIGEN_USERNAME, VIGEN_PASSWORD
```

**Env vars yang masih perlu ditambah (saat Meta Ads siap):**
```
META_APP_ID, META_APP_SECRET, META_PAGE_ACCESS_TOKEN,
META_AD_ACCOUNT_ID, META_LEAD_FORM_ID
```

---

## DEPLOY REFERENCE

```bash
# Build
gcloud builds submit \
  --project=crm-broker2026 \
  --tag asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest .

# Deploy
gcloud run deploy crm-broker-properti \
  --image asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  --region asia-southeast2 --project=crm-broker2026 --platform managed \
  --env-vars-file .env.yaml

# Verifikasi
curl -s https://crm.mansionpro.id/sw.js | head -3
```

> **PENTING:** Selalu `--env-vars-file .env.yaml` agar APP_VERSION ter-inject. Jangan deploy ke project `web-mansion2026`.
