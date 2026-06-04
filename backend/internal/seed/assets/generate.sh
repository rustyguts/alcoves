#!/usr/bin/env bash
# Regenerates the seed media assets embedded into the dev/test seeder.
#
# These are small, synthetic placeholder media (labeled gradients, short test
# videos with a tone, derived webp thumbnails/face-crops) — NOT real photos.
# They exist so `docker compose up` shows representative content in every view
# (grid, video player, people, map, timeline) without shipping real images.
#
# Requires: ImageMagick (`convert`), ffmpeg, cwebp.
# Run from anywhere: ./generate.sh   (writes next to this script)
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
IMG="$ROOT/images"
VID="$ROOT/videos"
AUD="$ROOT/audio"
THUMB="$ROOT/thumbs"
FACE="$ROOT/faces"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$IMG" "$VID" "$AUD" "$THUMB" "$FACE"

# ImageMagick v7 renamed `convert` -> `magick`; fall back to `convert` on v6.
MAGICK="magick"; command -v magick >/dev/null 2>&1 || MAGICK="convert"
# A concrete font file is required for -annotate (IM has no default on macOS).
FONT="${SEED_FONT:-/System/Library/Fonts/Supplemental/Arial.ttf}"
[ -f "$FONT" ] || FONT="$(fc-match -f '%{file}' sans 2>/dev/null || true)"
FONT_ARG=(); [ -n "$FONT" ] && [ -f "$FONT" ] && FONT_ARG=(-font "$FONT")

# make_image <file> <gradient> <label>
make_image() {
  "$MAGICK" -size 1024x768 "gradient:$2" \
    "${FONT_ARG[@]}" -gravity center -pointsize 56 -fill 'rgba(255,255,255,0.92)' -annotate +0+0 "$3" \
    -quality 82 "$IMG/$1"
  echo "image  $1"
}

make_image beach-sunset.jpg     '#fb923c-#7c2d12'  'Beach Sunset'
make_image mountain-lake.jpg    '#bae6fd-#0c4a6e'  'Mountain Lake'
make_image city-skyline.jpg     '#1e293b-#475569'  'City Skyline'
make_image forest-trail.jpg     '#86efac-#14532d'  'Forest Trail'
make_image desert-dunes.jpg     '#fde68a-#92400e'  'Desert Dunes'
make_image family-portrait.jpg  '#fbcfe8-#831843'  'Family Portrait'
make_image birthday-party.jpg   '#ddd6fe-#4c1d95'  'Birthday Party'
make_image golden-retriever.jpg '#fef3c7-#b45309'  'Golden Retriever'
make_image street-cafe.jpg      '#fed7aa-#7c2d12'  'Street Cafe'
make_image mountain-bike.jpg    '#a5f3fc-#155e75'  'Mountain Bike'

# make_video <file> <bg-gradient> <label> <duration> <freq>
make_video() {
  local out="$1" grad="$2" label="$3" dur="$4" freq="$5"
  "$MAGICK" -size 1280x720 "gradient:$grad" \
    "${FONT_ARG[@]}" -gravity center -pointsize 64 -fill 'rgba(255,255,255,0.92)' -annotate +0+0 "$label" \
    "$TMP/bg.png"
  ffmpeg -y -loglevel error \
    -loop 1 -i "$TMP/bg.png" \
    -f lavfi -i "sine=frequency=$freq:duration=$dur" \
    -t "$dur" -r 24 -c:v libx264 -pix_fmt yuv420p -profile:v baseline \
    -c:a aac -b:a 96k -shortest -movflags +faststart "$VID/$out"
  echo "video  $out"
}

make_video podcast-ep1.mp4    '#2563eb-#1e1b4b' 'Podcast - Episode 1' 6 220
make_video podcast-ep2.mp4    '#7c3aed-#2e1065' 'Podcast - Episode 2' 6 330
make_video vacation-recap.mp4 '#0d9488-#042f2e' 'Vacation Recap'      5 440

# Audio (mp3 tone). Fall back to AAC/m4a only if libmp3lame is unavailable.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libmp3lame; then
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=180:duration=8" \
    -c:a libmp3lame -b:a 128k "$AUD/interview-clip.mp3"
  echo "audio  interview-clip.mp3"
else
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=180:duration=8" \
    -c:a aac -b:a 128k "$AUD/interview-clip.m4a"
  echo "audio  interview-clip.m4a (libmp3lame missing)"
fi

# Video thumbnails (webp) — extracted first frame, scaled down.
make_thumb() {
  local src="$1" out="$2"
  ffmpeg -y -loglevel error -i "$VID/$src" -frames:v 1 -vf "scale=480:-1" "$TMP/f.png"
  cwebp -quiet -q 80 "$TMP/f.png" -o "$THUMB/$out"
  echo "thumb  $out"
}
make_thumb podcast-ep1.mp4    podcast-ep1.webp
make_thumb podcast-ep2.mp4    podcast-ep2.webp
make_thumb vacation-recap.mp4 vacation-recap.webp

# Face crops (webp) — small labeled squares standing in for cropped faces.
make_face() {
  "$MAGICK" -size 256x256 "gradient:$2" \
    "${FONT_ARG[@]}" -gravity center -pointsize 120 -fill 'rgba(255,255,255,0.95)' -annotate +0+0 "$3" \
    "$TMP/face.png"
  cwebp -quiet -q 85 "$TMP/face.png" -o "$FACE/$1"
  echo "face   $1"
}
make_face alice.webp   '#f59e0b-#b45309' 'A'
make_face bob.webp     '#3b82f6-#1e3a8a' 'B'
make_face unknown.webp '#64748b-#1e293b' '?'

echo "done."
