# CRM Mansion v2 — Patch & Deploy

## Fixes
- **PDF**: Karakter `Ð` di deskripsi → fix encoding `m²` dan sanitize non-Latin1
- **Form**: Field Luas Tanah/Bangunan, KT/KM, Sertifikat kosong → tambah input di modal

## Cara Deploy

```bash
# 1. Extract zip ke folder project
unzip -o ~/crm-v2-final.zip -d ~/crm-broker-properti/

# 2. One-click deploy (patch + gcloud)
bash ~/crm-broker-properti/deploy.sh
```

## Rollback
Backup otomatis tersimpan di `_patch_backup_YYYYMMDD_HHMMSS/` setelah patch dijalankan.
```bash
cp ~/crm-broker-properti/_patch_backup_*/backend/routes/listings.routes.js \
   ~/crm-broker-properti/backend/routes/
# dst...
```
