#!/usr/bin/env bash
# Build ghostty-vt.wasm from a Ghostty checkout and copy next to server.py.
# The binary is gitignored — do not commit it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=wasm.sh
source "$ROOT/scripts/wasm.sh"

if [[ -z "${GHOSTTY_ROOT:-}" ]]; then
  GHOSTTY_ROOT="$(nested_ghostty_root || true)"
fi
if [[ -z "${GHOSTTY_ROOT:-}" ]]; then
  cat >&2 <<'MSG'
Usage: GHOSTTY_ROOT=/path/to/ghostty ./scripts/fetch-or-build-wasm.sh

When this tree lives at example/wasm-browser-term inside a Ghostty
checkout, GHOSTTY_ROOT is detected automatically.
MSG
  exit 1
fi

build_ghostty_vt_wasm
echo "Wrote $GHOSTTY_VT_WASM ($(wc -c < "$GHOSTTY_VT_WASM") bytes)"
