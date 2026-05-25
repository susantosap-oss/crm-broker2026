# Mansion CRM — Developer Notes for Claude

> **Versi aktif:** v1.9.9 · **Last updated:** 2026-05-25

---

## CRITICAL: Deploy Configuration

### Live Domain
- URL: **https://crm.mansionpro.id**
- CDN: Cloudflare (proxied) → Google Cloud Load Balancer IP `35.190.122.67`

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
```

### WRONG — Jangan deploy ke ini
```
# project web-mansion2026 / service crm-broker2026 adalah project LAIN
# tidak terhubung ke crm.mansionpro.id
gcloud config get-value project  → mengembalikan "web-mansion2026" (SALAH untuk CRM)
```

### Cleanup artifact lama setelah deploy
```bash
# Hapus revisi Cloud Run lama (keep hanya yang aktif)
gcloud run revisions list --service=crm-broker-properti \
  --region=asia-southeast2 --project=crm-broker2026 \
  --format="value(metadata.name)" | grep -v <REVISION_AKTIF> | \
  xargs -P4 -I{} gcloud run revisions delete {} \
  --region=asia-southeast2 --project=crm-broker2026 --quiet
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
- **Video:** ViGen service (Cloud Run terpisah, di-poll tiap 2 menit)
- **Notif:** Telegram Bot + Web Push (VAPID)

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
```
