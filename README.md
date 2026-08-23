# WebAssembly Browser Terminal (PTY)

Minimal host shell in a PTY, streamed to the browser over WebSocket.
The page uses `ghostty-vt.wasm` to parse VT output (same approach as
[wasm-vt](../wasm-vt/)) and to encode keystrokes (same approach as
[wasm-key-encode](../wasm-key-encode/)) into the PTY stdin.

## Building

```bash
zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
```

## Running

You can start this from any working directory — `run.sh` and `server.py`
resolve the repo root from their own paths:

```bash
./example/wasm-browser-term/run.sh
# or
/path/to/ghostty/example/wasm-browser-term/run.sh
```

Then open:

```
http://127.0.0.1:8001/
```

Optional env vars: `PORT` (default `8001`), `SHELL`, `COLS`, `ROWS`.

Scrollback is enabled in the WASM terminal. The page renders the current
viewport only (so a full screen still scrolls correctly). Use the mouse
wheel or Page Up/Down to browse history; typing returns to the live prompt.

**Security:** this exposes a real interactive shell on localhost. Do not
bind it to a public interface or expose it beyond a trusted machine.
