#!/bin/bash
#
# Script deploy untuk server cPanel.
#
# Dijalankan oleh GitHub Actions lewat SSH setiap ada push ke main.
# Bisa juga dijalankan manual: bash ~/apps.rizkyfauzi.com/deploy.sh
#
# Yang dilakukan: tarik commit terbaru, lalu jalankan tugas yang sama
# dengan .cpanel.yml supaya hasilnya konsisten.

set -euo pipefail

REPO_DIR="$HOME/apps.rizkyfauzi.com"
DOCROOT="$REPO_DIR/public"
BRANCH="main"

echo "=== Deploy mulai: $(date '+%Y-%m-%d %H:%M:%S') ==="

cd "$REPO_DIR"

# --- 1. Tarik commit terbaru dari GitHub ---
echo "--- Menarik commit terbaru ---"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "Commit: $(git rev-parse --short HEAD)"

# --- 2. Salin isi public/ ke document root ---
# Document root ada di dalam folder repo, jadi ini sebenarnya menyalin
# ke dirinya sendiri. Tetap dilakukan supaya konsisten dengan
# .cpanel.yml kalau strukturnya berubah nanti.
echo "--- Menyalin aset ---"
mkdir -p "$DOCROOT"
cp -R public/. "$DOCROOT"

# --- 3. Bersihkan cache PHP kalau ada ---
# Opcache kadang menyimpan versi lama file PHP setelah update.
# Tidak semua hosting mengizinkan reload, jadi kegagalan diabaikan.
if command -v cachetool >/dev/null 2>&1; then
    cachetool opcache:reset 2>/dev/null || true
fi

# --- 4. Laporkan hasil ---
echo "--- Selesai ---"
echo "Commit aktif : $(cd "$REPO_DIR" && git rev-parse --short HEAD)"
echo "Document root: $DOCROOT"
echo "=== Deploy selesai: $(date '+%Y-%m-%d %H:%M:%S') ==="
