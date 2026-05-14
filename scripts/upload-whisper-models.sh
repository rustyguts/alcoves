#!/usr/bin/env bash
#
# Mirror every whisper.cpp GGML model in the admin allow-list to
# s3.rustyguts.net/models/ so the Alcoves backend's runtime model selector
# can switch between them without redeploys.
#
# Requires:
#   - curl, sha256sum
#   - rclone with the `rustyguts` remote already configured + push creds
#     (see docs/publishing-models.md for the one-time setup)
#
# Usage:
#   scripts/upload-whisper-models.sh                # upload all
#   scripts/upload-whisper-models.sh medium tiny    # upload subset
#   DRY_RUN=1 scripts/upload-whisper-models.sh      # plan only
#
# The script is idempotent — rclone skips files already in the bucket with
# matching size+mtime. Pass --force-recheck (via rclone) if you need to
# overwrite (rare; whisper-cli GGMLs are immutable per filename).

set -euo pipefail

STAGING_DIR="${STAGING_DIR:-/tmp/alcoves-whisper-models}"
REMOTE="${REMOTE:-rustyguts:models}"
BASE_HF="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
BASE_HF_QUANTS="https://huggingface.co/Pomni/whisper-large-v3-turbo-ggml-allquants/resolve/main"
BASE_HF_DISTIL="https://huggingface.co/Pomni/distil-large-v3.5-ggml-allquants/resolve/main"

# Map of admin allow-list ID → source URL. Keep IDs in sync with
# backend/internal/services/transcribe/whisper_models.go.
declare -A SOURCES=(
  ["tiny"]="${BASE_HF}/ggml-tiny.bin"
  ["base"]="${BASE_HF}/ggml-base.bin"
  ["small"]="${BASE_HF}/ggml-small.bin"
  ["medium"]="${BASE_HF}/ggml-medium.bin"
  ["large-v3"]="${BASE_HF}/ggml-large-v3.bin"
  ["large-v3-q5_0"]="${BASE_HF}/ggml-large-v3-q5_0.bin"
  ["large-v3-turbo-q5_0"]="${BASE_HF_QUANTS}/ggml-large-v3-turbo-q5_0.bin"
  ["large-v3-turbo-q4_0"]="${BASE_HF_QUANTS}/ggml-large-v3-turbo-q4_0.bin"
  ["distil-large-v3.5-q5"]="${BASE_HF_DISTIL}/ggml-distil-large-v3.5-q5_0.bin"
)

# Silero VAD — required by the transcribe worker for repetition-loop
# suppression on long non-speech audio. Keep mirrored alongside Whisper.
declare -A AUX=(
  ["silero-v6.2.0"]="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
)

DRY_RUN="${DRY_RUN:-}"

fetch() {
  local fname="$1" url="$2" dest="${STAGING_DIR}/${fname}"
  if [[ -f "$dest" ]]; then
    echo "  cached  $fname"
    return
  fi
  echo "  fetch   $fname"
  if [[ -n "$DRY_RUN" ]]; then
    echo "  (dry run: would curl -fL --retry 5 -o $dest $url)"
    return
  fi
  curl -fL --retry 5 --retry-delay 3 --progress-bar -o "${dest}.part" "$url"
  mv "${dest}.part" "$dest"
  echo "  sha256: $(sha256sum "$dest" | awk '{print $1}')"
}

upload() {
  local fname="$1" src="${STAGING_DIR}/${fname}"
  if [[ -n "$DRY_RUN" ]]; then
    echo "  (dry run: would rclone copy $src $REMOTE)"
    return
  fi
  rclone copy "$src" "${REMOTE}/" \
    --progress \
    --s3-chunk-size=64M \
    --s3-upload-concurrency=4 \
    --transfers=2
}

main() {
  local -a wanted=()
  if [[ $# -eq 0 ]]; then
    wanted=("${!SOURCES[@]}" "${!AUX[@]}")
  else
    wanted=("$@")
  fi

  mkdir -p "$STAGING_DIR"

  for id in "${wanted[@]}"; do
    if [[ -n "${SOURCES[$id]+x}" ]]; then
      url="${SOURCES[$id]}"
      fname="ggml-${id}.bin"
    elif [[ -n "${AUX[$id]+x}" ]]; then
      url="${AUX[$id]}"
      fname="ggml-${id}.bin"
    else
      echo "ERROR: unknown model id: $id (allow-list: ${!SOURCES[*]} ${!AUX[*]})" >&2
      exit 1
    fi

    echo "==> $id"
    fetch "$fname" "$url"
    upload "$fname"
  done

  echo ""
  echo "Done. Verify with:"
  echo "  rclone ls $REMOTE | grep -E '^[[:space:]]+[0-9]+ ggml-'"
}

main "$@"
