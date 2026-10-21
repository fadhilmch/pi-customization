#!/usr/bin/env bash
# Regenerate docs/media/*.gif and *.png.   Usage: demo/record.sh [tape-name ...]   (default: all)
# Requires: vhs (brew install vhs), pi on PATH, ffmpeg (pulled in by vhs). Optional: gifsicle (smaller GIFs).
set -euo pipefail
cd "$(dirname "$0")/.."

for bin in vhs pi; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 1; }
done
mkdir -p docs/media

if [ "$#" -gt 0 ]; then names=("$@"); else
  names=(); for f in demo/tapes/*.tape; do n="$(basename "$f" .tape)"; [ "${n:0:1}" = "_" ] || names+=("$n"); done
fi

for n in "${names[@]}"; do
  echo "==> $n"
  vhs "demo/tapes/$n.tape"
  if command -v gifsicle >/dev/null; then
    gifsicle -O3 --lossy=60 --colors 128 "docs/media/$n.gif" -o "docs/media/$n.gif.tmp" && mv "docs/media/$n.gif.tmp" "docs/media/$n.gif"
  fi
done
ls -la docs/media
