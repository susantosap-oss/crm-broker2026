#!/bin/bash
echo "📤 Mengirim update ke GitHub..."
git add .
git commit -m "Update otomatis: $(date +'%Y-%m-%d %H:%M')"
git push origin main
echo "✅ Berhasil tersimpan di GitHub!"
