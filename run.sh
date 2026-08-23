#!/usr/bin/env bash
# Start a host-shell PTY bridged to a browser terminal on port 8001.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8001}"
export PORT

WASM="$ROOT/zig-out/bin/ghostty-vt.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "Building ghostty-vt.wasm..."
  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
fi

echo "Starting browser terminal on http://127.0.0.1:${PORT}/"
exec python3 "$ROOT/example/wasm-browser-term/server.py"
