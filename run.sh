#!/usr/bin/env bash
# Start a host-shell PTY bridged to a browser terminal (loopback only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# shellcheck source=scripts/wasm.sh
source "$ROOT/scripts/wasm.sh"

PORT="${PORT:-8001}"
export PORT

ensure_ghostty_vt_wasm

echo "Starting browser terminal on http://127.0.0.1:${PORT}/"
exec python3 "$ROOT/server.py"
