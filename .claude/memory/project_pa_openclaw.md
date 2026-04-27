---
name: Project: OpenClaw PA + ViGen System
description: Architecture dan file yang dibuat untuk sistem Personal Assistant (OpenClaw), Video Engine (ViGen), dan Webhook Lead dari Meta Ads — Fitur 2 CRM
type: project
---

Sistem OpenClaw PA + ViGen dirancang dan diimplementasi pada sesi 2026-04-06.
Webhook Lead + ViGen Primary ditambahkan sesi 2026-04-07.

## File Baru yang Dibuat

### OpenClaw Service (Cloud Run terpisah)
- `openclaw/Dockerfile` — mcr.microsoft.com/playwright:v1.42.0-jammy
- `openclaw/server.js` — Express server, endpoint POST /job, GET /health, GET /status/:id
- `openclaw/utils/taskQueue.js` — In-memory queue singleton, auto-prune 2 jam
- `openclaw/utils/sessionManager.js` — GCS auth_state.json per agent (upload/download/invalidate)
- `openclaw/utils/humanMouse.js` — Bezier curve mouse movement, humanClick, humanType, humanPause
- `openclaw/workers/instagram.worker.js` — Playwright IG Reels/Story, anti-bot, daily limit 5
- `openclaw/workers/whatsapp.worker.js` — Playwright WA Web blast, 5 nomor/sesi, typing simulation

### Backend CRM
- `backend/routes/pa.routes.js` — PA + ViGen routes di bawah /api/v1/pa/*
- `backend/services/pa.service.js` — Credentials (AES-256-GCM), job management, SSE real-time
- `backend/services/vigen.service.js` — Bridge ke my-video-app, handle callback, update listing
- `backend/routes/meta-webhook.routes.js` — ★ Meta + Zapier webhook + config API

### Frontend
- `frontend/js/pa-dashboard.js` — Sidebar credentials, SSE logs, ViGen modal, WA Blast modal, ★ Webhook Config section

## Perubahan File Existing
- `backend/config/sheets.config.js` — +5 sheet: PA_CREDENTIALS, PA_JOBS, META_ADS_LOG, VIGEN_JOBS, ★WEBHOOK_CONFIG
- `backend/server.js` — Register /api/v1/pa + /api/v1/webhook routes, auto-migrate 5 sheet baru, rawBody untuk Meta signature
- `backend/services/sheets.service.js` — +getRows(), +updateRowCells()
- `backend/routes/pa.routes.js` — ★ POST /vigen/render support listing_type:'primary' (fetch PROJECTS sheet)
- `frontend/index.html` — Load pa-dashboard.js, tambah menu "Personal Assistant"; modal #modal-vigen; ★ tombol ViGen di modal-project-detail (#pd-vigen-btn)
- `frontend/js/app-mobile.js` — +openViGen, +openViGenProject (Primary), +_viGen.listingType, +submitViGenRender kirim listing_type, openProjectDetail show/hide pd-vigen-btn

## ★ Webhook Lead System (sesi 2026-04-07)

### Endpoints (semua di bawah /api/v1/webhook/)
- `GET  /config` — baca config webhook (semua role)
- `POST /config` — simpan config (superadmin|principal|kantor)
- `GET  /meta`   — verifikasi hub.challenge dari Meta App Dashboard
- `POST /meta`   — terima event leadgen dari Meta (verifikasi X-Hub-Signature-256)
- `POST /zapier` — terima lead dari Zapier (verifikasi zapier_secret)

### WEBHOOK_CONFIG sheet (KV store)
Keys: `webhook_type` | `meta_verify_token` | `zapier_secret` | `meta_page_access_token`
Default: `webhook_type = zapier` (auto-init saat startup)

### PA Sidebar — Webhook Config Section (semua role)
- Toggle: Zapier (rekomendasi) vs Meta Langsung
- Zapier: copy URL + Secret Key + instruksi setup 6 langkah
- Meta: copy Webhook URL + Verify Token + input Page Access Token
- Edit (toggle + save token): superadmin/principal/kantor only
- View (copy URL): semua role

## API Endpoints PA
- `GET  /api/v1/pa/credentials` — ambil kredensial PA agen
- `POST /api/v1/pa/credentials` — simpan credentials (password dienkripsi AES-256-GCM)
- `POST /api/v1/pa/trigger` — trigger job ig_reels|ig_story|wa_blast
- `GET  /api/v1/pa/logs/stream` — SSE real-time activity logs
- `GET  /api/v1/pa/jobs` — history jobs
- `POST /api/v1/pa/callback` — internal: callback dari OpenClaw
- `POST /api/v1/pa/qr-required` — internal: QR WA re-pairing notification
- `GET  /api/v1/pa/report/team` — laporan kinerja PA tim
- `POST /api/v1/pa/vigen/render` — trigger render video (secondary & primary)
- `POST /api/v1/pa/vigen/callback` — callback dari my-video-app
- `GET  /api/v1/pa/vigen/jobs/:listingId` — list render jobs

## Env Vars
```
PA_ENCRYPTION_KEY=<64-char hex>      # AES-256-GCM key
OPENCLAW_URL=https://openclaw-xxx.run.app
VIGEN_URL=https://my-video-app-xxx.run.app
VIGEN_CALLBACK_SECRET=<secret>
INTERNAL_SECRET=<shared secret antara CRM dan OpenClaw>
GCS_SESSION_BUCKET=mansion-pa-sessions
META_APP_SECRET=<dari Meta App Dashboard → hanya untuk mode Meta Langsung>
# Note: META_VERIFY_TOKEN & META_PAGE_ACCESS_TOKEN disimpan di WEBHOOK_CONFIG sheet (bisa diubah via UI)
```

**Why:** PA Digital Twin per agen — automasi IG Reels + WA Blast. Webhook lead otomatis dari iklan Meta (via Zapier atau Meta direct) → langsung masuk LEADS sheet + notifikasi ke agen.
**How to apply:** File sudah siap. Zapier bisa langsung dipakai tanpa daftar Meta App. Untuk mode Meta Langsung, butuh Meta for Developers + domain publik.
