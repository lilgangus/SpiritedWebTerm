#!/usr/bin/env bash
# Run SpiritedWebTerm Node tests (layer 1–2 from TESTING.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# shellcheck source=scripts/wasm.sh
source "$ROOT/scripts/wasm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run tests" >&2
  exit 1
fi

ensure_ghostty_vt_wasm

echo "Running SpiritedWebTerm tests..."
node --test "$ROOT/test/"*.test.mjs
python3 "$ROOT/test/origin_test.py"
