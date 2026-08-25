# WebAssembly Browser Terminal (PTY)

A Ghostty-like frontend for a real host shell. The page is chrome and input
only: **libghostty-vt** (WASM) parses all VT output and encodes keys, paste,
focus, and mouse into PTY bytes.

See [FEATURES.md](FEATURES.md) for what works and what does not.
See [TESTING.md](TESTING.md) for a regression plan (vim, less/`git log`, last-line `git push`).

## Layout

No bundler — the browser loads ES modules directly.

```
example/wasm-browser-term/
  index.html          markup only
  css/app.css         window chrome + screen
  js/main.js          boots wasm and the desktop
  js/desktop.js       floating windows, drag, resize, snap preview
  js/window.js        one window: titlebar, tabs, plus/max menus
  js/pane.js          one tab: VT terminal + PTY + chrome
  js/snap.js          left/right/corner snap geometry
  js/wasm.js          ghostty-vt.wasm heap / struct helpers
  js/terminal.js      VT session: parse, format, encode
  js/input.js         keyboard, clipboard, mouse, wheel
  js/pty.js           WebSocket PTY client
  js/chrome.js        cursor, scrollbar, title, cell metrics
  js/constants.js     libghostty-vt ABI values
  js/keymap.js        event.code → GhosttyKey
  server.py           static files + PTY WebSocket
  package.json        marks js/ as ES modules
  run.sh
```

`js/wasm.js`, `js/terminal.js`, `js/input.js`, and `js/pty.js` are reusable.
The rest of `js/` is this example's desktop chrome.

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
