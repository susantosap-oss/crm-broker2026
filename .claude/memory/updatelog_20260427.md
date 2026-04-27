---
name: Update Log 2026-04-27 — IG Post Graph API, ViGen Session Flow, PA Log Fix
description: Sesi 2026-04-27: implementasi IG Post Graph API, rewrite ViGen ke session-based API, fix SSE auth, PA log polling, ViGen caption issue noted
type: project
originSessionId: d356dbb1-e329-4914-90f0-f8e4813cf9fa
---
## Status Deploy: v1.3.5 (live di crm.mansionpro.id)
Commit: 54fbd0c

---

## Fitur IG Post — Skip sementara (pending setup Meta)

### Implementasi yang sudah selesai (kode siap, menunggu credentials Meta):
- `backend/services/ig-post.service.js` — Instagram Graph API via axios
- Flow: `POST /{ig_user_id}/media` → poll status (video) → `POST /media_publish`
- Support: ig_reels (video/foto ke feed), ig_story (foto/video story)
- PA_CREDENTIALS col R = `IG_Graph_User_ID`, col S = `IG_Graph_Access_Token`
- PA Settings sidebar: tambah input Graph API credentials
- IG modal: media optional, auto-pakai `Foto_Utama_URL` listing jika kosong
- Role restriction: IG Reels/Story hanya tampil untuk superadmin + principal

### Kenapa skip:
- Instagram Graph API butuh: IG Professional Account + Facebook Page connected + Meta Developer App
- User belum selesai setup Instagram User ID yang terkoneksi ke FB/Meta
- Kode sudah siap, tinggal isi `ig_graph_user_id` + `ig_graph_token` di PA Settings

### Instagram private-api (unofficial) — DITINGGALKAN:
- Gagal login dari Cloud Run IP (Google Cloud IP diblokir Instagram)
- Error: "We can't find an account with susanto_mansion" (bukan credentials salah, tapi IP block)

---

## ViGen — Session-based Flow (BERHASIL RENDER)

### Bug yang difix:
1. `VIGEN_URL` → `http://localhost:8082` → fix ke `https://mansion-vidgen-cb5stice7a-et.a.run.app`
2. `APP_URL` → salah isi URL ViGen → fix ke `https://crm.mansionpro.id`
3. Endpoint `/api/render-crm` tidak ada → rewrite ke session-based flow
4. `file_type=image` → 400 error → fix ke `file_type=photo` (ViGen valid: photo/clip/bgm/logo)

### Flow ViGen yang benar (FastAPI, session-based):
```
POST /api/login                    → token (field: "token", bukan "access_token")
POST /api/session                  → {sid}
POST /api/upload/{sid} (per foto)  → file_type=photo → {path}
POST /api/render/{sid}             → mulai render
GET  /api/status/{sid}             → poll setiap 2 menit (cron di server.js)
GET  /api/download/{sid}           → download video → upload ke Cloudinary
```

### ViGen Credentials (tersimpan di Cloud Run env):
- `VIGEN_USERNAME` = "Mansion tim"
- `VIGEN_PASSWORD` = "Mansiontim2026"
- Login response field: `token` (bukan `access_token`)

### PENDING — Caption/Text overlay di video terpotong:
**Problem:** `description` yang dikirim CRM: `"Rumah 1 Lantai Alam Hijau Citraland - Rp... - Kecamatan, Kota"` — tapi yang tampil di video hanya `"Rumah 1 Lantai Alam Hijau Citraland - Rp..."` (terpotong di harga).
**Root cause:** Text overlay di ViGen renderer punya batas lebar/karakter — sisa teks tidak muat di frame.
**Next step:** Ganti ViGen engine dengan versi baru (user bilang "nanti kita beda Vigen nya") — belum dikerjakan.

### ViGen render params yang dipakai CRM:
```javascript
{
  photo_paths:     [...],         // path dari /api/upload
  duration_target: 15|30|60,
  resolution:      '720p  (720×1280) Best',
  cta_nama:        agent.Nama,
  cta_wa:          agent.No_WA,
  description:     `${Judul} - ${Harga_Format} - ${Kecamatan}, ${Kota}`,
  n_captions:      3,
}
```

---

## PA Activity Log Fix

### Bug: SSE log tidak pernah tampil
**Root cause:** `EventSource` tidak bisa kirim `Authorization` header. Frontend kirim `?token=...` di URL, tapi `authMiddleware` hanya baca `req.headers.authorization` → selalu 401 → reconnect loop.
**Fix:** `auth.middleware.js` — fallback ke `req.query.token` jika header tidak ada.

### Tambahan: Polling fallback
- `_startLogPoller()` di pa-dashboard.js — poll `/pa/jobs` setiap 10 detik
- Handle Cloud Run multi-instance (SSE bisa ke instance berbeda dari trigger)
- Jobs dari Sheets langsung tampil di Activity Log meskipun SSE tidak sampai

---

## PA Routes Fix
- Hapus mandatory `video_url` check untuk IG jobs
- Auto-lookup foto dari `SHEETS.LISTING` (col Y = Foto_Utama_URL) atau `SHEETS.PROJECTS` (col K = Foto_1_URL) jika `video_url` kosong
- Lookup listing title dari kedua sheet (secondary + primary)
