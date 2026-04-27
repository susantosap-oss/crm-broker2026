---
name: Deploy Configuration — CRM crm.mansionpro.id
description: GCP project, Cloud Run service, dan commands yang benar untuk deploy CRM live
type: project
---

ALWAYS deploy ke GCP project `crm-broker2026`, service `crm-broker-properti`, region `asia-southeast2`.

**Why:** Domain `crm.mansionpro.id` → Cloudflare → Load Balancer IP `35.190.122.67` (project `crm-broker2026`) → NEG `mansion-crm-neg` → Cloud Run `crm-broker-properti` (asia-southeast2). Deploy ke project `web-mansion2026` atau service `crm-broker2026` TIDAK akan berpengaruh ke live domain.

**How to apply:** Selalu gunakan flag `--project=crm-broker2026` dan service name `crm-broker-properti` saat build/deploy. Verifikasi dengan `curl -s https://crm.mansionpro.id/sw.js | head -3`.

## Deploy Commands
```bash
gcloud builds submit \
  --project=crm-broker2026 \
  --tag asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  .

gcloud run deploy crm-broker-properti \
  --image asia-southeast2-docker.pkg.dev/crm-broker2026/cloud-run-source-deploy/crm-broker-properti:latest \
  --region asia-southeast2 \
  --project=crm-broker2026 \
  --platform managed
```

## Jangan deploy ke
- Project `web-mansion2026` service `crm-broker2026` — ini bukan server live CRM
- `gcloud config get-value project` defaultnya `web-mansion2026` — SALAH untuk CRM
