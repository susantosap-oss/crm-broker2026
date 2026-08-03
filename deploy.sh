#!/bin/bash
set -e
cd "$HOME/crm-broker-properti" || { echo "Folder tidak ditemukan!"; exit 1; }
echo ""
echo "================================================"
echo "  CRM Mansion v2.4.41 - Flyer dom-to-image-more"
echo "================================================"
echo ""
echo "Patch..."
python3 apply_patches.py || exit 1
echo ""
echo "Deploy..."
gcloud run deploy crm-broker-properti \
  --source . --region asia-southeast2 --project crm-broker2026 \
  --allow-unauthenticated \
  --service-account crm-sheets-sa@crm-broker2026.iam.gserviceaccount.com \
  --memory 512Mi --env-vars-file .env.yaml --clear-base-image
echo ""
echo "Done!"
