# Shared wasm path + build. Sourced by run.sh / run-tests.sh.
# ROOT must be set to this project's directory.

nested_ghostty_root() {
  local parent
  parent="$(cd "$ROOT/../.." && pwd)" || return 1
  if [[ -f "$parent/build.zig" && -f "$parent/src/lib_vt.zig" ]]; then
    printf '%s\n' "$parent"
    return 0
  fi
  return 1
}

ghostty_build_root() {
  if [[ -n "${GHOSTTY_ROOT:-}" ]]; then
    printf '%s\n' "$GHOSTTY_ROOT"
    return 0
  fi
  nested_ghostty_root
}

build_ghostty_vt_wasm() {
  local src
  src="$(ghostty_build_root)" || src=""
  if [[ -z "$src" ]]; then
    return 1
  fi
  if ! command -v zig >/dev/null 2>&1; then
    echo "zig is required to build ghostty-vt.wasm" >&2
    return 1
  fi
  echo "Building ghostty-vt.wasm from $src ..."
  (
    cd "$src"
    zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
  )
  local built="$src/zig-out/bin/ghostty-vt.wasm"
  if [[ ! -f "$built" ]]; then
    echo "Build succeeded but $built is missing" >&2
    return 1
  fi
  cp "$built" "$ROOT/ghostty-vt.wasm"
  export GHOSTTY_VT_WASM="$ROOT/ghostty-vt.wasm"
}

ensure_ghostty_vt_wasm() {
  local wasm="${GHOSTTY_VT_WASM:-$ROOT/ghostty-vt.wasm}"
  if [[ -f "$wasm" ]]; then
    export GHOSTTY_VT_WASM="$wasm"
    return 0
  fi
  if build_ghostty_vt_wasm; then
    return 0
  fi
  cat >&2 <<'MSG'
Missing ghostty-vt.wasm.

Place it at ./ghostty-vt.wasm, or set GHOSTTY_VT_WASM / GHOSTTY_ROOT.

  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
  cp zig-out/bin/ghostty-vt.wasm ./ghostty-vt.wasm

  GHOSTTY_ROOT=/path/to/ghostty ./scripts/fetch-or-build-wasm.sh
MSG
  return 1
}
