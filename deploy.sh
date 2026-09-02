#!/bin/bash
set -e

PROJECT="crm-broker2026"
SERVICE="crm-broker-properti"
REGION="asia-southeast2"
REPO="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"
IMAGE="${REPO}:latest"

echo ""
echo "=============================================="
echo "  CRM Mansion — Deploy Script"
echo "=============================================="
echo ""

# 1. Build & push image
echo "[1/4] Building image..."
gcloud builds submit \
  --project="${PROJECT}" \
  --tag="${IMAGE}" \
  .

# 2. Deploy ke Cloud Run
echo ""
echo "[2/4] Deploying to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --platform=managed \
  --env-vars-file=.env.yaml

# 3. Hapus revision lama
echo ""
echo "[3/4] Cleaning up old revisions..."
ACTIVE_REV=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(status.traffic[0].revisionName)")
echo "  Active revision: ${ACTIVE_REV}"
gcloud run revisions list --service="${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --format="value(metadata.name)" | grep -v "${ACTIVE_REV}" | \
  xargs -P4 -I{} gcloud run revisions delete {} \
  --region="${REGION}" --project="${PROJECT}" --quiet 2>/dev/null || true

# 4. Hapus image lama di Artifact Registry
echo ""
echo "[4/4] Cleaning up old artifact images..."
ACTIVE_DIGEST=$(gcloud artifacts docker images describe "${IMAGE}" \
  --project="${PROJECT}" --format="value(image_summary.digest)" 2>/dev/null)
echo "  Active digest: ${ACTIVE_DIGEST}"
gcloud artifacts docker images list "${REPO}" \
  --project="${PROJECT}" --format="value(version)" | \
  grep -v "${ACTIVE_DIGEST}" | \
  xargs -P4 -I{} gcloud artifacts docker images delete \
  "${REPO}@{}" --project="${PROJECT}" --delete-tags --quiet 2>/dev/null || true

echo ""
echo "=============================================="
echo "  Deploy selesai!"
echo "  Verifikasi: curl -s https://crm.mansionpro.id/sw.js | head -2"
echo "=============================================="
echo ""
