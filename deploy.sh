#!/bin/bash
set -e
cd "$HOME/crm-broker-properti" || { echo "Folder tidak ditemukan!"; exit 1; }
echo ""
echo "================================================"
echo "  CRM Mansion v5 — Force Logout + CSV Export"
echo "================================================"
echo ""
echo "🔧 [1/2] Patch..."
python3 apply_patches.py || exit 1
echo ""
echo "🚀 [2/2] Deploy..."
gcloud run deploy crm-broker-properti \
  --source . --region asia-southeast2 --project crm-broker2026 \
  --allow-unauthenticated \
  --service-account crm-sheets-sa@crm-broker2026.iam.gserviceaccount.com \
  --memory 512Mi --env-vars-file .env.yaml --clear-base-image
echo ""
echo "✅ Done!"
