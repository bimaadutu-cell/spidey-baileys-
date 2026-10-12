#!/usr/bin/env bash
# Menaikkan frame rate video sumber (interpolasi gerak) supaya tidak patah-patah.
# Pakai:  ./scripts/smooth-video.sh input.mp4 output.mp4 [fps=60]
# Catatan: 60 fps = standar mulus & didekode hardware di hampir semua HP.
#          120 fps butuh layar 120Hz; interpolasi 120 fps jauh lebih berat & file lebih besar.
set -euo pipefail
IN="${1:?input.mp4}"; OUT="${2:?output.mp4}"; FPS="${3:-60}"
ffmpeg -y -i "$IN" \
  -vf "minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  -c:a copy "$OUT"
