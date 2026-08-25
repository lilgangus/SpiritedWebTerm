# Testing plan: critical terminal behavior

Goal: catch regressions that break **full-screen apps** (vim, less via `git log`) and **live output on a full screen** (`git push` at the last line) before they ship again.

These failures are easy to miss in casual use: the shell prompt looks fine until an alt-screen app runs, or until scrollback is created on the last visible row.

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

| Test | Input | Assert |
| --- | --- | --- |
| Full grid HTML | CUP to every row with text; last row `STATUS` | Formatted text has `rows` lines; last line is `STATUS` |
| Blank-row padding | Fill only first 10 rows + status on last row | After `applyHtml` (or equivalent pad), DOM has exactly `rows` `.row` nodes; last row is status |
| Alt screen | `\x1b[?1049h`, clear, fill all rows, status on last | Same as full grid; `activeScreen` / alt flag is alternate |
| Leave alt | Then `\x1b[?1049l` | Primary content returns; row count still matches pane size |
| Resize sync | `resize(80,40)` then pretend JS thinks 40 while WASM is still 24 | Sync path forces WASM to 40 before format; no `grid_ref` failure / full scrollback dump |
| Viewport selection | After scrollback + alt screen | Selection uses viewport rectangle of size `cols×rows`; never asks for y ≥ WASM rows |

Keep helpers small: `writeVt(term, bytes)`, `stripHtml(html)`, `rowTexts(screenEl)`.

### 2. Integration (Node + fake PTY bytes)

Replay recorded VT streams (or generate them) through `term.write` → `formatHtml` → row pad.

Suggested fixtures (store under `testdata/` later):

- `vim-open-status.vt` — alt screen, tilde rows, inverted status line
- `less-git-log.vt` — alt screen, pager chrome, last line is status/prompt
- `git-push-last-line.vt` — primary screen full, then many `\r` progress updates on the last row
- `exit-alt-restore.vt` — open alt, leave alt, primary prompt on last row

Assert after each fixture: `domRows === term.rows`, last non-pad content on last row when the app put it there.

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

## Suggested automation shape (later)

```
testdata/*.vt          # recorded or synthetic VT
js/test/
  terminal_grid.test.mjs   # WASM + format + pad
  apply_html.test.mjs      # Chrome.applyHtml row count
scripts/manual-smoke.md    # checklist A–E (or this file)
```

Prefer Node `node --test` (or similar) for layer 1–2 so CI can run without a browser. Layer 3 stays manual until Playwright/Puppeteer is worth the cost.

## When to run

| Change touches | Run |
| --- | --- |
| `chrome.js` render / `applyHtml` / resize | Unit + manual A, B, C |
| `terminal.js` format / selection / resize | Unit grid + selection |
| `input.js` / wheel / followLive | Manual C, D |
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
