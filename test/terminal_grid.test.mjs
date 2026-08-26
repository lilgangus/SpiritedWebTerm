import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
    C,
    MODE_ALT_SCREEN_SAVE,
    loadWasm,
    createTerm,
    writeVt,
    cup,
    clearScreen,
    formatLines,
    mockChrome,
    paint,
    rowTexts,
    rowCount,
    syncSize,
} from "./helpers.mjs";

const COLS = 80;
const ROWS = 40;

describe("terminal grid (WASM + format + pad)", () => {
    /** @type {import("../js/wasm.js").Wasm} */
    let wasm;

    before(async () => {
        wasm = await loadWasm();
    });

    it("full grid HTML: rows lines and last line is STATUS", () => {
        const term = createTerm(wasm, COLS, ROWS);
        let seq = clearScreen();
        for (let r = 1; r <= ROWS; r++) {
            seq += cup(r) + `R${String(r).padStart(2, "0")}`;
        }
        seq += cup(ROWS) + "STATUS";
        writeVt(term, seq);

        const lines = formatLines(term.formatHtml());
        assert.equal(lines.length, ROWS);
        assert.match(lines[ROWS - 1], /STATUS/);
        assert.equal(term.cellCountData(C.DATA_ROWS), ROWS);
    });

    it("blank-row padding: applyHtml yields exactly rows .row nodes", () => {
        const term = createTerm(wasm, COLS, ROWS);
        let seq = clearScreen();
        for (let r = 1; r <= 10; r++) seq += cup(r) + `L${r}`;
        seq += cup(ROWS) + "STATUS";
        writeVt(term, seq);

        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        // Force the pad path: feed fewer lines than rows.
        chrome.applyHtml("<div>L1\nL2</div>");
        assert.equal(rowCount(chrome.screen), ROWS);
        const padded = rowTexts(chrome.screen);
        assert.equal(padded[0], "L1");
        assert.equal(padded[1], "L2");
        assert.equal(padded[ROWS - 1], "");

        // Status on VT last row stays on the last visual row after pad.
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS);
        assert.match(rowTexts(chrome.screen)[ROWS - 1], /STATUS/);
    });

    it("alt screen: full grid and mode 1049 is on", () => {
        const term = createTerm(wasm, COLS, ROWS);
        assert.equal(term.mode(MODE_ALT_SCREEN_SAVE), false);

        let seq = "\x1b[?1049h" + clearScreen();
        for (let r = 1; r <= ROWS; r++) seq += cup(r) + `~`;
        seq += cup(ROWS) + "STATUS";
        writeVt(term, seq);

        assert.equal(term.mode(MODE_ALT_SCREEN_SAVE), true);
        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS);
        assert.match(rowTexts(chrome.screen)[ROWS - 1], /STATUS/);
    });

    it("leave alt: primary content returns; row count matches pane", () => {
        const term = createTerm(wasm, COLS, ROWS);
        writeVt(term, clearScreen() + cup(1) + "PRIMARY_PROMPT");
        writeVt(term, "\x1b[?1049h" + clearScreen() + cup(ROWS) + "ALT_STATUS");
        assert.equal(term.mode(MODE_ALT_SCREEN_SAVE), true);

        writeVt(term, "\x1b[?1049l");
        assert.equal(term.mode(MODE_ALT_SCREEN_SAVE), false);

        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS);
        const joined = rowTexts(chrome.screen).join("\n");
        assert.match(joined, /PRIMARY_PROMPT/);
        assert.doesNotMatch(joined, /ALT_STATUS/);
    });

    it("resize sync: JS taller than WASM forces resize before format", () => {
        const term = createTerm(wasm, COLS, 24);
        writeVt(term, clearScreen() + cup(1) + "ok");

        const chrome = mockChrome(term, { cols: COLS, rows: 40 });
        // Desync: chrome wants 40 while WASM is still 24.
        assert.equal(term.cellCountData(C.DATA_ROWS), 24);

        // Clamped format must not throw (anti-pattern: grid_ref past WASM size).
        assert.doesNotThrow(() => term.formatHtml());

        syncSize(chrome);
        assert.equal(term.cellCountData(C.DATA_ROWS), 40);
        assert.equal(term.cellCountData(C.DATA_COLS), COLS);

        paint(chrome);
        assert.equal(rowCount(chrome.screen), 40);
    });

    it("viewport selection uses cols×rows and never asks past WASM rows", () => {
        const term = createTerm(wasm, COLS, 24);
        let seq = clearScreen();
        for (let r = 1; r <= 24; r++) seq += cup(r) + `R${r}`;
        writeVt(term, seq);

        // JS claims a taller pane than WASM — selection must clamp, not fail.
        term.rows = 40;
        term.cols = COLS;
        assert.doesNotThrow(() => {
            const html = term.formatHtml();
            const lines = formatLines(html);
            assert.ok(lines.length <= 24);
        });

        // After syncing WASM up, applyHtml still paints the full pane height
        // (formatter may omit trailing blanks; pad restores them).
        term.resize(COLS, 40, 8, 17);
        assert.equal(term.cellCountData(C.DATA_ROWS), 40);
        const chrome = mockChrome(term, { cols: COLS, rows: 40 });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), 40);
    });

    it("last-line CR progress stays on the bottom row without shrinking the grid", () => {
        const term = createTerm(wasm, COLS, ROWS);
        let seq = clearScreen();
        for (let r = 1; r < ROWS; r++) seq += cup(r) + `line ${r}`;
        seq += cup(ROWS) + "Counting objects:   0%";
        writeVt(term, seq);

        for (const pct of [10, 50, 100]) {
            writeVt(term, `\rCounting objects: ${String(pct).padStart(3)}%`);
        }

        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS);
        assert.match(rowTexts(chrome.screen)[ROWS - 1], /Counting objects:\s*100%/);
        assert.match(rowTexts(chrome.screen)[0], /line 1/);
    });
});
