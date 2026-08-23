# WebAssembly Browser Terminal (PTY)

A Ghostty-like frontend for a real host shell. The page is chrome and input
only: **libghostty-vt** (WASM) parses all VT output and encodes keys, paste,
focus, and mouse into PTY bytes.

See [FEATURES.md](FEATURES.md) for what works and what does not.

## Building

```bash
zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
```

## Running

`run.sh` and `server.py` find the repo root from their own paths:

```bash
./example/wasm-browser-term/run.sh
```

Then open:

```
http://127.0.0.1:8001/
```

Optional env vars: `PORT` (default `8001`), `SHELL`, `COLS`, `ROWS`.

## Input

| Chord | Action |
| --- | --- |
| Ctrl+C / Ctrl+D / Ctrl+Z / … | Encoded by ghostty-vt and written to the PTY |
| Cmd+C (macOS) or Ctrl+Shift+C | Copy selection |
| Cmd+V (macOS) or Ctrl+Shift+V | Paste (`ghostty_paste_encode`) |
| Cmd+A / Ctrl+Shift+A | Select all |
| Cmd+/Ctrl + `+` `-` `0` | Font size |
| Wheel / scrollbar | Scrollback (Shift+wheel if the app is tracking the mouse) |

**Security:** this exposes a real interactive shell on localhost. Do not
bind it to a public interface or expose it beyond a trusted machine.
