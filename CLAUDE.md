# Mansion CRM — Developer Notes for Claude

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

# 2. Deploy
gcloud run deploy crm-broker-properti \
  --image asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  --region asia-southeast2 \
  --project=crm-broker2026 \
  --platform managed
```

### WRONG — Jangan deploy ke ini
```
# project web-mansion2026 / service crm-broker2026 adalah project LAIN
# tidak terhubung ke crm.mansionpro.id
gcloud config get-value project  → mengembalikan "web-mansion2026" (SALAH untuk CRM)
```

### Verifikasi deploy sudah masuk ke server yang benar
```bash
curl -s https://crm.mansionpro.id/sw.js | head -3
# Harus menampilkan APP_VERSION yang sesuai dengan deploy terbaru
```

---

## Service Worker Versioning
- Setiap kali ada perubahan frontend, **bump APP_VERSION** di `frontend/sw.js`
- Versi juga harus diupdate di `<meta name="app-version">` di `frontend/index.html`
- Hard refresh browser TIDAK bypass SW cache — hanya version bump yang membersihkan cache lama

## Architecture
- Backend : `backend/` (Node.js/Express)
- Frontend : `frontend/` (Vanilla JS SPA)
- Database : Google Sheets (SSoT via googleapis)
- Dockerfile: di root, copy `backend/` dan `frontend/`

## Roles
`superadmin | principal | kantor | business_manager | admin | agen`
- Role disimpan lowercase di Google Sheets kolom F (AGENTS sheet)
- JWT payload field: `role`
