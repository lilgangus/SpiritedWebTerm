#!/usr/bin/env bash
# Run wasm-browser-term Node tests (layer 1–2 from TESTING.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXAMPLE="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

WASM="$ROOT/zig-out/bin/ghostty-vt.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "Building ghostty-vt.wasm..."
  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run tests" >&2
  exit 1
fi

echo "Running wasm-browser-term tests..."
exec node --test "$EXAMPLE/test/"*.test.mjs
