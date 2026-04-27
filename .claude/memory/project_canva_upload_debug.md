---
name: Canva Asset Upload Debug Progress
description: Status debug Canva /asset-uploads endpoint — belum berhasil, progress iterasi error
type: project
---

## Status: BELUM SELESAI — asset upload masih gagal

**Why:** Canva Connect API (`OC-` prefix app) menggunakan endpoint non-standar untuk upload asset. Setiap iterasi memberikan error berbeda yang membantu mempersempit masalah.

**How to apply:** Lanjutkan debug dari iterasi terakhir saat melanjutkan session.

---

## Yang Sudah Berhasil
- OAuth2 PKCE flow → ✅ refresh_token tersimpan di Sheets CONFIG (`Canva_Refresh_Token`)
- `getAccessToken()` via refresh_token → ✅ token valid
- `POST /rest/v1/autofills` → belum ditest (tunggu asset upload selesai dulu)
- Cloudinary upload via base64 → ✅ (sudah proven di fitur lain)

## Iterasi Error Asset Upload (urutan kronologis)

| Attempt | Endpoint | Method | Content-Type | Header Extra | Error |
|---------|----------|--------|--------------|--------------|-------|
| 1 | `/rest/v1/assets` | POST | `image/jpeg` | `Asset-Name: b64` | "Content-Type image/jpeg is invalid for /rest/v1/assets" |
| 2 | `/rest/v1/assets` | POST | `application/octet-stream` | `Asset-Name: b64` | "Content-Type application/octet-stream is invalid for /rest/v1/assets" |
| 3 | `/rest/v1/asset-uploads` | POST | `application/json` | body: `{name_base64}` | "Unsupported content type, expected: application/octet-stream, application/offset+octet-stream" |
| 4 | presigned URL dari step 3 | PUT | `image/jpeg` | - | "Unsupported content type, expected: application/octet-stream, application/offset+octet-stream" |
| 5 | presigned URL dari step 3 | PATCH | `application/offset+octet-stream` | TUS headers | same error |
| 6 | `/rest/v1/asset-uploads` | POST | `application/octet-stream` | `Asset-Name: b64` | "Invalid upload metadata header" |
| 7 | `/rest/v1/asset-uploads` | POST | `application/octet-stream` | `Upload-Metadata: name b64`, `Tus-Resumable: 1.0.0`, `Upload-Length: N` | "Invalid upload metadata header" |

## Analisis Saat Ini
- Error #3 konfirmasi: `/asset-uploads` butuh `application/octet-stream` (bukan JSON)
- Error #6 dan #7: Content-Type sudah diterima, tapi metadata header format salah
- "Invalid upload metadata header" mungkin merujuk ke format `Upload-Metadata` yang salah

## Yang Perlu Dicoba Selanjutnya
1. Coba tanpa `Upload-Metadata` sama sekali (hanya binary + `Tus-Resumable` + `Upload-Length`)
2. Coba `Upload-Metadata: filename dGVzdF9jcm0uanBn` (key `filename` bukan `name`)
3. Coba base64url (URL-safe) untuk nilai metadata: `Buffer.from(x).toString('base64url')`
4. Coba `Upload-Metadata: name dGVzdF9jcm0uanBn,filetype aW1hZ2UvanBlZw==` (tambah filetype)
5. Cek Canva SDK source di GitHub atau Canva developer forum untuk contoh yang berhasil
6. Gunakan `application/offset+octet-stream` (bukan `application/octet-stream`) dengan TUS headers

## File yang Diubah
- `backend/services/canva.service.js` — uploadAsset() (iterasi ke-7)
- `backend/routes/agents.routes.js` — test endpoint + migrate-all endpoint
- `frontend/js/app-mobile.js` — uploadProfilePhotoCanva(), PA/ViGen hidden untuk agen/koordinator
- `frontend/index.html` — Canva overlay UI + superadmin migrate button, v1.2.1
- `frontend/sw.js` — version 1.2.1

## Revisi Cloud Run Terakhir
`crm-broker-properti-00057-l4j`
