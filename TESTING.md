# Testing plan: critical terminal behavior

Goal: catch regressions that break **full-screen apps** (vim, less via `git log`) and **live output on a full screen** (`git push` at the last line) before they ship again.

These failures are easy to miss in casual use: the shell prompt looks fine until an alt-screen app runs, or until scrollback is created on the last visible row.

## Running automated tests

```bash
./run-tests.sh
```

Builds `ghostty-vt.wasm` if missing (from `GHOSTTY_ROOT` or a parent Ghostty
checkout), then runs Node tests under `test/` via `node --test` plus
`test/origin_test.py`. No browser required. Layer 3 (manual smoke) is still below.

## What must never regress

| Feature | Failure signal |
| --- | --- |
| vim / less / `git log` | Status/command line sits mid-pane; dead space under the app; after `:q` / `q` the shell “bottom” is wrong |
| Size sync | CSS/`this.rows` ≠ WASM rows ≠ PTY `LINES` |
| Full-screen paint | Fewer than `rows` painted lines when the VT grid is full (formatter trims blanks) |
| `git push` / progress at last line | New output invisible or one-line-at-a-time while keys still work |
| Enter / leave alt screen | Primary scrollback state leaks into vim/less layout |

## Layers

### 1. Unit / Node (fast, no browser)

Drive `ghostty-vt.wasm` + `Terminal` / `Chrome.applyHtml` without a PTY.

**Setup:** load WASM from disk, create a terminal at known `cols×rows` (e.g. 80×40).

| Test | File | Input | Assert |
| --- | --- | --- | --- |
| Full grid HTML | `terminal_grid.test.mjs` | CUP to every row with text; last row `STATUS` | Formatted text has `rows` lines; last line is `STATUS` |
| Blank-row padding | `terminal_grid.test.mjs` | Short HTML and/or first 10 rows + status on last | After `applyHtml`, DOM has exactly `rows` `.row` nodes; VT status stays on last visual row |
| Alt screen | `terminal_grid.test.mjs` | `\x1b[?1049h`, clear, fill all rows, status on last | Same as full grid; mode 1049 is on |
| Leave alt | `terminal_grid.test.mjs` | Then `\x1b[?1049l` | Primary content returns; row count still matches pane size |
| Resize sync | `terminal_grid.test.mjs` | JS wants 40 while WASM is still 24 | Sync path forces WASM to 40 before format; no `grid_ref` failure |
| Viewport selection | `terminal_grid.test.mjs` | JS `rows` > WASM rows, then resize | Selection clamps (never asks for y ≥ WASM rows); after sync, pad paints full pane |
| Last-line `\r` progress | `terminal_grid.test.mjs` | Full screen then CR updates on last row | Grid stays `rows` tall; last row shows final progress text |
| `applyHtml` pad / slice | `apply_html.test.mjs` | Short HTML; HTML longer than `rows` with `followLive` on/off | Exact `.row` count; live end vs top slice; palette `<style>` extracted |
| `urlAtColumn` | `url.test.mjs` | Plain-text URL under a column | Hit span / `https://` normalize / trailing punct trim / miss → null |

Helpers live in `test/helpers.mjs`: `writeVt`, `stripHtml`, `rowTexts`, `mockChrome`, `paint`, `syncSize`.

### 2. Integration (Node + recorded VT)

Replay fixtures through `term.write` → `formatHtml` → `applyHtml` pad (`fixtures.test.mjs`).

Fixtures under `testdata/`:

- `vim-open-status.vt` — alt screen, tilde rows, inverted status line
- `less-git-log.vt` — alt screen, pager chrome, last line is `(END)`
- `git-push-last-line.vt` — primary screen full, then many `\r` progress updates on the last row
- `exit-alt-restore.vt` — open alt, leave alt, primary prompt restored

Assert after each fixture: `domRows === term.rows`, last-row / restore content when the app put it there.

### 3. Manual smoke (browser + real shell)

Run `./run.sh`, hard-refresh, open a **new** terminal session each run.

**A. Size / vim**

1. Open a new window/tab (session starts on its own); note the pane is taller than 24 rows.
2. `vim` (empty buffer is fine).
3. Press `:` — command line must sit on the **last visual row** of the pane (not mid-window).
4. `:q!` — shell prompt must sit on the **same** last visual row.

**B. less / git log**

1. In a repo: `git log` (opens less).
2. Status / `(END)` / pager chrome must sit on the last visual row.
3. `q` — shell bottom still correct.

**C. git push at last line**

1. Fill the screen (`seq 1 200` or similar) so the prompt is on the last row.
2. Run something chatty on one line (`git push`, or a fake progress script with `\r`).
3. Output must stay visible; terminal must not freeze or show only one updating line while hiding the rest.

**D. Scroll then alt screen**

1. Create scrollback; wheel up so you’re not following live.
2. Open `vim` or `git log`.
3. Full-screen app must still fill the pane (stale `followLive=false` must not shorten the grid).

**E. Resize while in vim**

1. Open vim; drag window larger/smaller.
2. Status line must track the new bottom; no permanent mid-pane gap.

## Pass criteria (shared)

For any full-height case:

1. `CSS --rows` == JS `ui.rows` == WASM `DATA_ROWS` == PTY `LINES` (within one paint after resize).
2. DOM has exactly `rows` `.row` elements.
3. Cursor / status on VT row `rows-1` appears at the bottom of `.screen`, not above a blank band.
4. After leaving alt screen, (1)–(3) still hold for the shell.

## Automation layout

Production (`js/`, `css/`, …) stays separate from tests:

```
testdata/*.vt              # recorded / synthetic VT streams
test/
  helpers.mjs              # WASM load, VT helpers, Chrome mock
  terminal_grid.test.mjs   # WASM + format + pad + resize/selection
  apply_html.test.mjs      # Chrome.applyHtml row count / followLive
  fixtures.test.mjs        # replay testdata/*.vt
  url.test.mjs             # urlAtColumn (no WASM)
  origin_test.py           # /ws Origin allow-list (no WASM)
run-tests.sh               # wasm if needed + node --test + origin_test.py
TESTING.md                 # this plan + manual checklist A–E
```

Prefer Node `node --test` for layer 1–2 so CI can run without a browser. Layer 3 stays manual until Playwright/Puppeteer is worth the cost.

## When to run

| Change touches | Run |
| --- | --- |
| `chrome.js` render / `applyHtml` / resize | `./run-tests.sh` + manual A, B, C |
| `terminal.js` format / selection / resize | `./run-tests.sh` (grid + selection) |
| `url.js` | `./run-tests.sh` (`url.test.mjs`) |
| `server.py` Origin / loopback | `python3 test/origin_test.py` |
| `input.js` / wheel / followLive | Manual C, D (+ `apply_html` followLive cases) |
| `pane.js` connect / reset | Manual A (open session) |
| CSS `.screen` / `.row` / cell metrics | Manual A, B, E |

## Anti-patterns that already broke us

Document these so reviewers spot them in PRs:

- Painting fewer rows than the pane (`min(cssRows, wasmRows)` without resizing WASM).
- Dumping formatter HTML without padding trimmed blank lines.
- Formatting full scrollback when viewport `grid_ref` fails.
- Leaving shell `followLive=false` / scrolled viewport active when entering alt screen.
- Measuring cell height with `line-height: var(--cell-h)` (metrics chase themselves).

## Out of scope (for this plan)

Window chrome, snap, tabs, copy/paste — cover separately. This plan is only the **viewport grid + alt screen + live last-line output** contract.
