---
name: Update Log 2026-04-20 — OpenClaw PA Bug Fixes + Arsitektur Klarifikasi
description: Log lengkap sesi 2026-04-20: fix PA modal, ViGen listing_type, VIGEN_URL, klarifikasi OpenClaw bukan service terpisah, pending IG+WA implementation
type: project
---

## Status Deploy: v1.1.9 (live di crm.mansionpro.id)

## Bug Fixes Yang Sudah Selesai

### Fix 1 — PA Modal "No action" (WA Blast / IG Reels / IG Story)
**Root cause:** `initPADashboard()` tidak pernah dipanggil → `_injectPAStyles()` tidak jalan → class `pa-modal-backdrop` tidak punya CSS → modal render sebagai plain div tanpa positioning/overlay.
**Fix:** Tambah `if (typeof initPADashboard === 'function') initPADashboard();` di `showApp()` di `app-mobile.js` (sekitar baris 3184).
**File:** `frontend/js/app-mobile.js`

### Fix 2 — window._allListings & window._projectsData tidak ter-expose
**Root cause:** `openWABlastModal()` dan `openIGPostModal()` di pa-dashboard.js baca `window._allListings` dan `window._projectsData`, tapi variabel tersebut hanya lokal di app-mobile.js.
**Fix:** Tambah `window._allListings = _allListings` dan `window._projectsData = _projectsData` di semua titik assignment (5 lokasi: baris ~510, ~2656, ~2662, ~3987, ~4722).
**File:** `frontend/js/app-mobile.js`

### Fix 3 — Primary ViGen "Listing tidak ditemukan"
**Root cause:** `submitViGenRender()` di pa-dashboard.js tidak mengirim `listing_type` → backend default ke secondary → project ID tidak ditemukan di LISTING sheet.
**Fix:** Tambah `listing_type: window._viGen?.listingType || 'secondary'` di API call pa-dashboard.js baris ~911.
**File:** `frontend/js/pa-dashboard.js`

### Fix 4 — Zapier → Pipedream
- Semua teks "Zapier" di UI pa-dashboard.js diganti "Pipedream"
- Backend route `/webhook/zapier/:agent_id` tetap ada sebagai backward compat alias
- Route baru: `/webhook/pipedream/:agent_id` (primary)
- URL template: `${baseUrl}/api/v1/webhook/pipedream/{agent_id}`
- File panduan baru: `frontend/panduan-pipedream.html`

### Fix 5 — VIGEN_URL ECONNREFUSED
**Root cause:** `VIGEN_URL=http://localhost:8082` di Cloud Run env → tidak ada service di localhost.
**Fix:** Update env var via `gcloud run services update` → `VIGEN_URL=https://mansion-vidgen-cb5stice7a-et.a.run.app`
**Service:** `mansion-vidgen` ada di project `web-mansion2026`, region `asia-southeast2`.

### Fix 6 — SW Cache & Pipedream text di PWA
- SW version bump: 1.1.1 → 1.1.8 → 1.1.9
- JS query strings: `?v=20260420` → `?v=20260421`
- Server.js: `/js` static files pakai `no-cache, must-revalidate`
- index.html: meta `app-version` = 1.1.9; CURRENT_SW_VERSION baca dari meta tag (bukan hardcode)

---

## PENDING — OpenClaw WA Blast & IG Post Implementation

### Klarifikasi Arsitektur Penting
**OpenClaw BUKAN service terpisah.** User belum pernah develop OpenClaw sebagai microservice. Fitur WA Blast dan IG Post dimasukkan ke dalam CRM, bukan di-handle oleh service eksternal.

**Problem saat ini:**
- `pa.service.js::triggerJob()` memanggil `this._sendToOpenClaw(payload)` yang POST ke `{OPENCLAW_URL}/job`
- `OPENCLAW_URL=http://localhost:8081` → ECONNREFUSED di Cloud Run
- Tidak ada automation code (puppeteer, baileys, playwright, dll) di backend CRM

**Intended behavior (konfirmasi user 2026-04-20):**
1. **WA Blast**: Pilihan (B) — buka WhatsApp Web (wa.me link) dengan pesan sudah terisi, PA atur timing antar nomor dengan human habit / snippet, maks 5 nomor, anti-block oleh Meta
2. **IG Post**: Pilihan (A) — auto-post ke Instagram agen, maks 5 konten berbeda per queue, PA atur waktu posting secara berurutan

### Rencana Implementasi (belum dikerjakan)

#### WA Blast — Frontend-controlled sequential sender
- Hapus call `_sendToOpenClaw()` untuk wa_blast
- Backend: simpan job di GSheets → kembalikan data recipient + message ke frontend
- Frontend `submitWABlast()`: loop recipients, buka `wa.me/{nomor}?text={encoded}` dengan delay random 20-60 detik antar tab
- Delay pakai `setTimeout` + random jitter
- Tampilkan progress: "Membuka WA untuk nomor 2/5... tunggu 35 detik"

#### IG Post — Butuh library automation
- Perlu install `instagram-private-api` di backend atau alternatif lain
- Agent login dengan ig_username + ig_password (sudah tersimpan terenkripsi di PA_CREDENTIALS)
- Queue system sudah ada di frontend (igQueue), tinggal backend processor
- Implementasi: `paService._executeIGJob(jobId, credentials, mediaUrl, caption, type)`
- Anti-bot: random delay 5-15 menit antar post

### File yang perlu diubah untuk WA Blast fix:
1. `backend/services/pa.service.js` — bypass `_sendToOpenClaw()` untuk wa_blast, kembalikan recipients+message ke route
2. `backend/routes/pa.routes.js` — return `{ success, recipients, message, job_id }` untuk wa_blast
3. `frontend/js/pa-dashboard.js::submitWABlast()` — handle response, buka wa.me links sequentially

### Cloud Run Services Map
```
project: crm-broker2026
  crm-broker-properti  → https://crm-broker-properti-vnd6joen4a-et.a.run.app  (MAIN CRM)

project: web-mansion2026
  mansion-vidgen       → https://mansion-vidgen-cb5stice7a-et.a.run.app       (VIGEN ENGINE ✅)
  crm-broker2026       → https://crm-broker2026-cb5stice7a-et.a.run.app       (old/unknown, 403)
  web-mansion2026      → https://web-mansion2026-cb5stice7a-et.a.run.app
  music-tab-ai-frontend
```

### Env Vars Cloud Run (crm-broker-properti, crm-broker2026):
```
OPENCLAW_URL     = http://localhost:8081  ← masih localhost, perlu diubah atau dihapus
VIGEN_URL        = https://mansion-vidgen-cb5stice7a-et.a.run.app  ← sudah fix ✅
OPENCLAW_INTERNAL_SECRET = dev-openclaw-secret-local
```

---

## Versi File Saat Ini
- `frontend/sw.js`: APP_VERSION = '1.1.9'
- `frontend/index.html`: app-version = 1.1.9, script ?v=20260421
- Deploy: revision crm-broker-properti-00040-ppm (env update VIGEN_URL)
