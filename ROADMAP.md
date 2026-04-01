# CRM Broker Properti — Development Roadmap

> **Last updated:** 2026-04-01
> **Status aktif:** Fitur 1 selesai & live. Fitur 2 pending (menunggu domain publik + akun IG Business).

---

## FITUR 1 — AKTIVITAS HARIAN & ROLE KANTOR ✅ DONE

**Deploy:** `crm-broker-properti-00216-7sl` · asia-southeast1
**Commit terakhir:** `7aa1d4a`

### Yang sudah dikerjakan:
- Sheet baru `AKTIVITAS_HARIAN` (auto-create saat startup via `ensureSheet()`)
- Kolom `Aktivitas_Count` di AGENTS (untuk scoring)
- Role `kantor` level 4 — privilege = principal, hidden dari Member, penerima webhook Meta Ads
- `aktivitas.service.js` + `aktivitas.routes.js` (GET/POST/DELETE `/api/v1/aktivitas`)
- Frontend: nav "Aktivitas" dengan 2 main tab (Jadwal | Aktivitas Harian)
- Aktivitas Harian: navigasi per hari ← →, input via modal + FAB
- Manajemen User: role "Kantor" tersedia di form Add/Edit
- **web-mansion2026:** scoring P8 Aktivitas Harian (10 poin/aktivitas, editable di Admin Dashboard)
- **Tab Tim** — BM lihat aktivitas anggota timnya, Principal/Kantor lihat seluruh tim kantor (sub-tab Saya | Tim, grouped by agen)

---

## FITUR 2 — AUTO AI VIDEO + META ADS + SMART LEAD ROUTER ⏳ PENDING

> **Pre-requisite yang masih disiapkan:**
> - [ ] Domain publik untuk CRM & web-mansion (bukan URL Cloud Run)
> - [ ] Akun Instagram Kantor → convert ke **Business Account**
> - [ ] Facebook Page terhubung ke Instagram Business
> - [ ] Meta Business Manager aktif + Ad Account
> - [ ] Meta App review (untuk Marketing API & Lead Ads API) — estimasi 1–2 minggu

---

### ARSITEKTUR SISTEM

```
CRM (Principal/Kantor)
  → pilih Listing/Project → klik "Promote"
      │
      ▼
Video Engine (my-video-app · Cloud Run · us-central1)
  → AI Spec (Gemini) → render 9:16 → upload Cloudinary
      │
      ▼
CRM: Meta Ads Bridge
  → upload video ke Meta Ad Library
  → buat Ad Creative + Lead Form
  → launch campaign
      │
      ▼ (webhook saat ada lead)
CRM: Smart Lead Router
  → auto-create Lead (role Kantor)
  → cascade WA notification (30-min timeout per step)
  → auto-reply WA ke prospek
```

---

### TUGAS 1 — VIDEO BRIDGE PAYLOAD (CRM → my-video-app)

**Endpoint my-video-app yang akan dibuat:** `POST /api/render-crm`

```json
{
  "listing_id": "LST-2024-001",
  "listing_type": "secondary",
  "mood": "mewah",
  "media": {
    "photos": ["https://res.cloudinary.com/.../foto_1.jpg"],
    "video_clips": [],
    "bgm_preset": "luxury_ambient"
  },
  "dynamic_text": {
    "harga": "Rp 2,5 M",
    "lokasi": "Citraland, Surabaya",
    "tipe": "Rumah 4KT · SHM",
    "agen_nama": "Budi Santoso",
    "agen_wa": "6281234567890"
  },
  "output": {
    "cloudinary_folder": "mansion_properti/LST-2024-001/ads",
    "resolution": "1080p",
    "duration_target": 30
  },
  "callback_url": "https://crm.domain.com/api/v1/video-callback"
}
```

**Alur callback:**
1. my-video-app render selesai → upload ke Cloudinary → POST ke `callback_url`
2. CRM terima URL video → simpan di sheet → lanjut ke Meta Ads API

---

### TUGAS 2 — PYTHON: FITUR YANG PERLU DITAMBAH DI my-video-app

**Yang sudah ada (tidak perlu diubah):**
- 9:16 portrait, Pass1 MoviePy + Pass2 FFmpeg
- Safe zones: `CAPTION_Y=0.52`, `CTA_Y=0.66`, `SAFE_BOTTOM=0.78` ← sudah cukup
- Color grading, AI Spec via Gemini

**Yang perlu ditambah:**

**a) Cloudinary upload (saat ini my-video-app masih pakai local storage)**
```python
import cloudinary.uploader

def upload_to_cloudinary(local_path, listing_id, media_type="ads"):
    result = cloudinary.uploader.upload(
        local_path,
        resource_type="video",
        folder=f"mansion_properti/{listing_id}/{media_type}",
        public_id=f"video_{int(time.time())}",
    )
    return result["secure_url"]
```

**b) Random Variation — anti-duplicate file hash**
```python
import random, hashlib, time

fade_dur = round(random.uniform(0.10, 0.30), 3)  # variasi transisi
salt = hashlib.md5(f"{listing_id}{time.time()}".encode()).hexdigest()[:6]
# inject ke metadata → setiap render punya hash unik
```

**c) Audio Ducking (BGM turun saat Voiceover/dialog)**
```
# Tambah ke FFmpeg filtergraph di run_pass2():
# Sekarang: [va][vb]amix=inputs=2:normalize=0[aout]
# Ganti dengan sidechaincompress:

[bgm]asplit=2[bgm_main][bgm_detect];
[voiceover][bgm_detect]sidechaincompress=threshold=0.02:ratio=4:attack=5:release=300[bgm_ducked];
[bgm_ducked][voiceover]amix=inputs=2:normalize=0[aout]
```

**d) Mood preset mapping (Minimalis vs Mewah)**
```python
MOOD_PRESET = {
    "minimalis": {
        "font": "fonts/Roboto-Black.ttf",
        "caption_color": "White",
        "color_grade": {"brightness": 1.05, "contrast": 1.1, "saturation": 0.9},
        "transition": "Crossfade",
        "bgm_preset": "minimal_piano"
    },
    "mewah": {
        "font": "fonts/PlayfairDisplay-Bold.ttf",
        "caption_color": "Gold",
        "color_grade": {"brightness": 1.0, "contrast": 1.15, "saturation": 1.1},
        "transition": "Fade to Black",
        "bgm_preset": "luxury_ambient"
    }
}
```

---

### TUGAS 3 — META ADS API INTEGRATION

**Stack:** Facebook Marketing API v21.0
**Perlu:** Long-lived Page Access Token + Ad Account ID + Lead Form ID

**Alur:**
```
1. Upload video ke Meta Ad Library
   POST /v21.0/{ad_account_id}/advideos
   Body: { file_url: "{cloudinary_url}" }
   → Dapat: video_id (async, perlu polling status)

2. Buat Ad Creative
   POST /v21.0/{ad_account_id}/adcreatives
   Body: {
     name: "CRM-LST-001-{tanggal}",
     video_data: {
       video_id: "{video_id}",
       title: "{judul_listing}",
       call_to_action: {
         type: "LEARN_MORE",
         value: { lead_gen_form_id: "{form_id}" }
       }
     }
   }
   → Dapat: creative_id

3. Buat Ad (dalam AdSet existing)
   POST /v21.0/{ad_account_id}/ads
   Body: {
     name: "Ad-LST-001",
     adset_id: "{adset_id}",
     creative: { creative_id: "{creative_id}" },
     status: "ACTIVE"
   }
```

**Simpan di sheet CRM:**
```
Sheet: META_ADS_LOG
Kolom: ID, Listing_ID, Video_URL, Meta_Video_ID, Creative_ID, Ad_ID,
       Form_ID, Status, Budget, Created_At, Created_By
```

---

### TUGAS 4 — META WEBHOOK → SMART LEAD ROUTER

**Webhook endpoint di CRM:** `POST /api/v1/webhook/meta`

**Verifikasi webhook (wajib):**
```javascript
// Verifikasi signature X-Hub-Signature-256
const sig = req.headers['x-hub-signature-256'];
const expected = 'sha256=' + crypto
  .createHmac('sha256', process.env.META_APP_SECRET)
  .update(rawBody).digest('hex');
if (sig !== expected) return res.status(401).send('Invalid');
```

**Parse Lead Form data:**
```javascript
// Ambil detail lead dari Meta Graph API
const leadDetail = await fetch(
  `https://graph.facebook.com/v21.0/${leadgen_id}?fields=field_data,ad_id&access_token=${PAGE_TOKEN}`
);
// field_data: [{name: "full_name", values: ["Budi"]}, {name: "phone_number", values: ["+628..."]}]
```

**Auto-create Lead di CRM:**
- Sumber: `Meta Ads`
- Agen_ID: akun `Kantor` (role kantor)
- Score: `Hot` (lead dari ads = hot intent)
- Keterangan: nama iklan + listing/project terkait

---

### TUGAS 5 — SMART LEAD CASCADE (30-MENIT TIMEOUT)

**Implementasi timer:** Google Cloud Tasks (sudah di ekosistem GCP)

**Token system untuk link WA:**
```javascript
// Setiap notif generate token unik + expiry
const token = crypto.randomUUID();
const expiry = Date.now() + (30 * 60 * 1000); // 30 menit
// Simpan di sheet LEAD_CLAIM_TOKENS: lead_id, token, agen_id, expiry, status

// Link di WA:
// https://crm.domain.com/api/v1/lead-claim/{lead_id}/{token}
```

**State Machine Secondary (Listing):**
```
[BARU]
  │
  ├─ Step 1: WA → Owner Listing ──── 30 mnt ──→ [TIMEOUT] → Step 2
  │                └─ Klik link ──────────────→ [ASSIGNED: Owner] DONE
  │
  ├─ Step 2: WA → CoOwner (random 1) ─ 30 mnt → [TIMEOUT] → next CoOwner / Step 3
  │                └─ Klik link ──────────────→ [ASSIGNED: CoOwner] DONE
  │
  └─ Step 3: WA → Principal (no limit)
```

**State Machine Primary (Project):**
```
[BARU]
  │
  ├─ Step 1: WA → Koordinator project ── 30 mnt ─→ [TIMEOUT] → Step 2
  │
  ├─ Step 2: WA → Agen scoring tertinggi sesuai {city}
  │           (bergiliran, 30 mnt/agen, hingga semua dicoba)
  │
  ├─ Step 3: WA → Business Manager ── 30 mnt ─→ [TIMEOUT] → Step 4
  │
  └─ Step 4: WA → Principal (no limit)
```

**Sheet baru yang dibutuhkan:**
```
LEAD_NOTIFICATIONS:
  ID, Lead_ID, Step, Target_Role, Target_Agen_ID, Token,
  Sent_At, Expires_At, Claimed_At, Status (pending/claimed/expired)
```

---

### TUGAS 6 — AUTO CHAT KE LEAD (WA)

**Trigger:** Saat lead baru masuk dari webhook Meta
**Gunakan:** `WA_QUEUE` yang sudah ada di CRM

```javascript
// Template pesan otomatis ke nomor lead
const pesan = `Halo ${lead.Nama}! 👋

Terima kasih sudah tertarik dengan properti *${listing.Judul}* di *${listing.Kota}*.

Tim properti kami akan segera menghubungi Anda dalam waktu dekat.

Untuk informasi lebih lanjut, silakan kunjungi:
🏠 ${web_url}/listings/${listing.slug}

Salam,
*MANSION Realty*`;

// Masukkan ke WA_QUEUE → kirim via WA Business API
```

---

### TUGAS 7 — CLOUDINARY FOLDER STRUCTURE (Node.js)

```javascript
const cloudinary = require('cloudinary').v2;

// Upload foto listing
async function uploadListingPhoto(filePath, listingId, idx) {
  return cloudinary.uploader.upload(filePath, {
    resource_type: 'image',
    folder: `mansion_properti/${listingId}/photos`,
    public_id: `foto_${idx}`,
    overwrite: true,
    transformation: [{ width: 1080, crop: 'limit' }],
  });
}

// Upload video hasil render
async function uploadAdsVideo(videoUrl, listingId) {
  return cloudinary.uploader.upload(videoUrl, {
    resource_type: 'video',
    folder: `mansion_properti/${listingId}/ads`,
    public_id: `ads_${Date.now()}`,
    tags: [listingId, 'meta_ads'],
  });
}

// Upload raw clip dari agen
async function uploadRawClip(filePath, listingId) {
  return cloudinary.uploader.upload(filePath, {
    resource_type: 'video',
    folder: `mansion_properti/${listingId}/raw`,
    chunk_size: 6000000, // 6MB chunks untuk file besar
  });
}
```

---

### SOLUSI VIDEO RAW UPLOAD DI CRM

**Problem:** CRM belum ada fitur upload video dari device agen.

**Rekomendasi: Opsi B — agen gunakan my-video-app**

```
Alur yang paling clean:
Agen login ke my-video-app
  → upload foto/video clip
  → render dengan AI
  → hasil otomatis tersimpan ke Cloudinary
  → CRM polling / callback untuk ambil URL
  → CRM tampilkan preview video di halaman Listing
  → Principal/Kantor klik "Promote to Meta Ads"
```

**Tidak perlu** buat upload video baru di CRM — my-video-app sudah jadi dedicated video editor.

---

### PERMISSION GATE — PROMOTE TO META ADS

Hanya role **`principal`** dan **`kantor`** yang bisa:
- Melihat tombol "Promote to Meta Ads" di halaman Listing/Project
- Set budget iklan
- Launch / pause campaign

```javascript
// Backend guard
const canPromote = ['principal', 'kantor', 'superadmin'].includes(req.user.role);
if (!canPromote) return res.status(403).json({ message: 'Akses ditolak' });

// Frontend (checkAdminMenu di app-mobile.js)
const btnPromote = document.getElementById('btn-promote-ads');
if (btnPromote) {
  btnPromote.style.display =
    ['principal', 'kantor'].includes(STATE.user?.role) ? 'flex' : 'none';
}
```

---

### TINGKAT KESULITAN & URUTAN PENGERJAAN

| # | Komponen | Difficulty | Est. | Pre-requisite |
|---|----------|-----------|------|---------------|
| 1 | Cloudinary di my-video-app + callback ke CRM | 🟡 Medium | 1–2 hr | — |
| 2 | Video bridge payload (CRM → engine) | 🟡 Medium | 2–3 hr | No.1 |
| 3 | Meta Webhook → CRM Lead (parsing + auto-create) | 🟡 Medium | 2 hr | Domain publik |
| 4 | Auto WA reply ke lead | 🟢 Easy | 1 hr | No.3 |
| 5 | Smart Lead cascade 30-mnt (Cloud Tasks) | 🔴 Hard | 4–5 hr | No.3 |
| 6 | Meta Ads API (upload video + creative + launch) | 🔴 Hard | 4–5 hr | IG Business + Meta App review |
| 7 | CRM UI: tombol Promote, status iklan, laporan | 🟡 Medium | 2–3 hr | No.6 |

**Total estimasi:** ~15–19 hari kerja efektif

**Bottleneck utama:**
- **Meta App review** bisa 1–2 minggu — ajukan segera setelah IG Business aktif
- **Cloud Tasks** perlu setup IAM permissions di GCP
- **Domain publik** wajib ada sebelum webhook Meta bisa dikonfigurasi

---

### CHECKLIST PRE-DEVELOPMENT

- [ ] Domain publik CRM aktif (misal: `crm.mansionrealty.id`)
- [ ] Domain publik web-mansion aktif (misal: `mansionrealty.id`)
- [ ] Instagram Kantor → convert ke Business Account
- [ ] Hubungkan Instagram Business ke Facebook Page
- [ ] Buat Facebook Business Manager
- [ ] Buat Ad Account di Business Manager
- [ ] Submit Meta App untuk Marketing API + Lead Ads API
- [ ] Buat Lead Form template di Meta Business Suite
- [ ] Setup Cloudinary account (jika belum ada Organization plan)

---

### CATATAN TEKNIS LAINNYA

**Sheet baru yang perlu dibuat saat Fitur 2 dev:**
```
META_ADS_LOG       → tracking iklan per listing
LEAD_NOTIFICATIONS → tracking cascade notif + token claim
```

**Env vars baru yang perlu ditambah di .env.yaml:**
```yaml
META_APP_ID: "xxx"
META_APP_SECRET: "xxx"
META_PAGE_ACCESS_TOKEN: "xxx"
META_AD_ACCOUNT_ID: "act_xxx"
META_LEAD_FORM_ID: "xxx"
CLOUDINARY_URL: "cloudinary://api_key:api_secret@cloud_name"
```

**my-video-app env vars:**
```
CLOUDINARY_CLOUD_NAME=xxx
CLOUDINARY_API_KEY=xxx
CLOUDINARY_API_SECRET=xxx
CRM_CALLBACK_SECRET=xxx  ← untuk verifikasi callback dari video engine ke CRM
```
