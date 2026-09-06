# SpiritedWebTerm

A Ghostty-like frontend for a real host shell in the browser. The page is
chrome and input only: **libghostty-vt** (`ghostty-vt.wasm`) parses all VT
output and encodes keys, paste, focus, and mouse into PTY bytes.

See [FEATURES.md](FEATURES.md) for what works and what does not.
See [TESTING.md](TESTING.md) for a regression plan (vim, less/`git log`, last-line `git push`).
See [NOTICE](NOTICE) for Ghostty / libghostty-vt attribution.

## Layout

No bundler — the browser loads ES modules directly.

```
.
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
  js/search.js        in-pane find
  js/url.js           plain URL hit-testing
  js/constants.js     libghostty-vt ABI values
  js/keymap.js        event.code → GhosttyKey
  server.py           static files + PTY WebSocket (loopback)
  package.json        marks js/ as ES modules
  run.sh
  run-tests.sh
  scripts/fetch-or-build-wasm.sh
  ghostty-vt.wasm     not committed — build or copy locally
```

`js/wasm.js`, `js/terminal.js`, `js/input.js`, and `js/pty.js` are reusable.
The rest of `js/` is this app's desktop chrome.

## Getting `ghostty-vt.wasm`

This repo does not vendor the WASM binary. Build it from
[ghostty-org/ghostty](https://github.com/ghostty-org/ghostty):

```bash
# in a Ghostty checkout
zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
cp zig-out/bin/ghostty-vt.wasm /path/to/SpiritedWebTerm/ghostty-vt.wasm
```

Or from this tree (detects a parent Ghostty checkout automatically when
this project lives at `example/wasm-browser-term`):

```bash
./scripts/fetch-or-build-wasm.sh
# or: GHOSTTY_ROOT=/path/to/ghostty ./scripts/fetch-or-build-wasm.sh
# or: GHOSTTY_ROOT=/path/to/ghostty ./run.sh
```

Override path with `GHOSTTY_VT_WASM=/path/to/ghostty-vt.wasm`.

This frontend uses current libghostty-vt WASM helpers
(`ghostty_wasm_alloc_u8_array`, `ghostty_wasm_alloc_opaque`, …) and
`ghostty_type_json` (flat struct map, or schema-1 `{ types, abi }` if present).

## Running

```bash
./run.sh
```

Then open:

```
http://127.0.0.1:8001/
```

Optional env vars: `PORT` (default `8001`), `SHELL`, `COLS`, `ROWS`,
`GHOSTTY_VT_WASM`, `GHOSTTY_ROOT`.

## Tests

```bash
./run-tests.sh
```

URL-only tests (no WASM): `node --test test/url.test.mjs`

## Input

| Chord | Action |
| --- | --- |
| Ctrl+C / Ctrl+D / Ctrl+Z / … | Encoded by ghostty-vt and written to the PTY |
| Cmd+C (macOS) or Ctrl+Shift+C | Copy selection |
| Cmd+V (macOS) or Ctrl+Shift+V | Paste (`ghostty_paste_encode`) |
| Cmd+A / Ctrl+Shift+A | Select all |
| Cmd+F (macOS) or Ctrl+Shift+F | Find in scrollback |
| Cmd+/Ctrl + `+` `-` `0` | Font size |
| Wheel / scrollbar | Scrollback (Shift+wheel if the app is tracking the mouse) |
| Click a plain http(s) URL | Open in a new browser tab |

## Security

This exposes a **real interactive shell** on **127.0.0.1** only. Browser
WebSocket upgrades to `/ws` are rejected when `Origin` is present and does not
match the request host (loopback aliases `localhost` / `127.0.0.1` / `::1` are
treated as equivalent). There is still **no login**; do not bind this to a
public interface or expose it beyond a trusted machine.
