# Mansion CRM — Developer Notes for Claude

> **Versi aktif:** v2.5.20 · **Last updated:** 2026-09-23

---

## CRITICAL: Deploy Configuration

### Live Domain
- URL: **https://crm.mansionpro.id**
- Routing: Cloudflare (proxied) → **Cloudflare Worker `crm-proxy`** → Cloud Run `*.run.app`
- ⚠️ Tidak ada Load Balancer — LB dihapus 2026-08-20 (cost optimization)

### Correct Deploy Target
```
GCP Project : crm-broker2026
Service Name: crm-broker-properti
Region      : asia-southeast2 (Jakarta)
Service URL : https://crm-broker-properti-80037699510.asia-southeast2.run.app
```

### Deploy Commands (ALWAYS use these)
```bash
# 1. Build image
gcloud builds submit \
  --project=crm-broker2026 \
  --tag asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  .

# 2. Deploy — WAJIB --env-vars-file agar APP_VERSION ter-inject
gcloud run deploy crm-broker-properti \
  --image asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  --region asia-southeast2 \
  --project=crm-broker2026 \
  --platform managed \
  --env-vars-file .env.yaml

# 3. Verifikasi
curl -s https://crm.mansionpro.id/sw.js | head -3
# Harus menampilkan APP_VERSION terbaru

# 4. WAJIB — Cleanup artifact lama (jalankan setiap kali setelah deploy)
# Ambil nama revisi aktif dulu:
ACTIVE_REV=$(gcloud run services describe crm-broker-properti \
  --region=asia-southeast2 --project=crm-broker2026 \
  --format="value(status.traffic[0].revisionName)")

# Hapus semua revisi lama:
gcloud run revisions list --service=crm-broker-properti \
  --region=asia-southeast2 --project=crm-broker2026 \
  --format="value(metadata.name)" | grep -v "$ACTIVE_REV" | \
  xargs -P4 -I{} gcloud run revisions delete {} \
  --region=asia-southeast2 --project=crm-broker2026 --quiet

# Hapus semua image lama di Artifact Registry (sisakan hanya digest aktif):
# CATATAN: image pakai tag :latest (bukan @sha256), jadi ambil digest via artifacts describe
REPO="asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti"
ACTIVE_DIGEST=$(gcloud artifacts docker images describe "${REPO}:latest" \
  --project=crm-broker2026 --format="value(image_summary.digest)")

gcloud artifacts docker images list "$REPO" \
  --project=crm-broker2026 --format="value(version)" | \
  grep -v "$ACTIVE_DIGEST" | \
  xargs -P4 -I{} gcloud artifacts docker images delete \
  "${REPO}@{}" --project=crm-broker2026 --delete-tags --quiet

# Hapus Cloud Build source artifacts di GCS (penyebab Cloud Storage spike):
# Lifecycle policy 7-hari sudah terpasang (2026-09-23), tapi hapus manual juga aman
gcloud storage rm "gs://crm-broker2026_cloudbuild/source/**" \
  --project=crm-broker2026 2>/dev/null || true
```

### WRONG — Jangan deploy ke ini
```
# project web-mansion2026 / service crm-broker2026 adalah project LAIN
# tidak terhubung ke crm.mansionpro.id
gcloud config get-value project  → mengembalikan "web-mansion2026" (SALAH untuk CRM)
```

---

## Service Worker & Versioning

- **APP_VERSION** satu sumber kebenaran: `.env.yaml` → Cloud Run env → `server.js` inject ke `sw.js` + `index.html` saat startup
- Setiap ada perubahan frontend → **bump APP_VERSION** di `.env.yaml`
- Hard refresh browser TIDAK bypass SW cache — hanya version bump yang membersihkan cache lama
- Placeholder `__APP_VERSION__` di `frontend/sw.js` diganti runtime oleh `server.js`

---

## Architecture

```
frontend/index.html   — Vanilla JS SPA (single file, semua UI + logic)
frontend/js/app.js    — helper functions desktop
frontend/js/app-mobile.js — mobile-specific logic
frontend/sw.js        — Service Worker (PWA, push notif)
backend/server.js     — Express entry point, route mounting, auto-migrate headers
backend/routes/       — per-fitur router
backend/services/     — Google Sheets, Cloudinary, ViGen, Push, Cron, dll
backend/config/sheets.config.js — SHEETS + COLUMNS definisi (satu sumber)
Dockerfile            — di root, build backend/ + frontend/
```

- **Database:** Google Sheets (SSoT via `googleapis`)
- **Media:** Cloudinary (foto listing, legal docs)
- **Video:** ViGen service (Cloud Run terpisah, di-poll via Cloud Scheduler tiap 2 menit)
- **Notif:** Telegram Bot + Web Push (VAPID)
- **Scheduled Jobs:** GCP Cloud Scheduler (bukan node-cron in-process)
  - `cron-jadwal-harian` → 19:00 WIB → `POST /api/v1/scheduler/check-jadwal-harian`
  - `cron-rental-reminders` → 08:00 WIB → `POST /api/v1/scheduler/check-rental-reminders`
  - `poll-vigen` → tiap 2 menit → `POST /api/v1/scheduler/poll-vigen`
  - WAG autopost internal (listing) → 08:00 + 16:00 WIB → `POST /api/v1/scheduler/wag-autopost` body `{"type":"listing"}`
  - WAG autopost aset → 09:00 + 15:00 WIB → `POST /api/v1/scheduler/wag-autopost` body `{"type":"aset"}`
  - WAG autopost external (listing) → 12:00 + 19:00 WIB → `POST /api/v1/scheduler/wag-autopost-external` (**baru v2.5.20**)
  - Auth: header `X-Scheduler-Secret` (nilai di `.env.yaml` key `SCHEDULER_SECRET`)
  - WAG_CONFIG kolom `Kategori` (F): `internal|external` — hanya berlaku untuk tipe listing/all

---

## Roles

`superadmin | principal | kantor | business_manager | admin | agen`

- Role disimpan lowercase di Google Sheets kolom F (sheet AGENTS)
- JWT payload field: `role`
- Hierarki akses: superadmin > principal ≈ kantor > business_manager > admin > agen

---

## Konvensi Penting

### Tambah sheet/kolom baru
1. Daftarkan di `backend/config/sheets.config.js` (SHEETS + COLUMNS)
2. Tambahkan ke `migrateHeaders()` di `server.js` (bagian `ensureSheet` loop)
3. Sheet otomatis dibuat saat server restart pertama kali

### State frontend
- Global `STATE` object: `STATE.user` (nama, role, id, no_wa, no_wa_biz, nama_kantor)
- Draft auto-save: `localStorage` dengan key per-form
- PDF export: `html2canvas` + `jsPDF` (sudah di-load di index.html)

### ENV vars kritis
```
GOOGLE_SHEETS_ID      — spreadsheet SSoT
CLOUDINARY_*          — upload foto/dokumen
PA_ENCRYPTION_KEY     — AES-256-GCM untuk kredensial PA (32-byte hex)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — Web Push
TELEGRAM_BOT_TOKEN    — notif internal
VIGEN_URL / VIGEN_USERNAME / VIGEN_PASSWORD — Video Engine
APP_VERSION           — versi app, di-inject ke SW + index.html
SCHEDULER_SECRET      — secret header untuk Cloud Scheduler endpoints (32-byte hex)
```
