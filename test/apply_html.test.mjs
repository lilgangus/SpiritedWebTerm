import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
    loadWasm,
    createTerm,
    writeVt,
    cup,
    clearScreen,
    mockChrome,
    paint,
    rowTexts,
    rowCount,
} from "./helpers.mjs";

const COLS = 80;
const ROWS = 24;

describe("Chrome.applyHtml", () => {
    /** @type {import("../js/wasm.js").Wasm} */
    let wasm;

    before(async () => {
        wasm = await loadWasm();
    });

    it("pads trimmed blank lines up to this.rows", () => {
        const term = createTerm(wasm, COLS, ROWS);
        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        chrome.applyHtml("<div>a\nb</div>");
        assert.equal(rowCount(chrome.screen), ROWS);
        const texts = rowTexts(chrome.screen);
        assert.equal(texts[0], "a");
        assert.equal(texts[1], "b");
        assert.equal(texts[ROWS - 1], "");
    });

    it("when HTML is longer than rows and followLive, keeps the live end", () => {
        const term = createTerm(wasm, COLS, ROWS);
        const chrome = mockChrome(term, { cols: COLS, rows: 5, followLive: true });
        const lines = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n");
        chrome.applyHtml(`<div>${lines}</div>`);
        assert.equal(rowCount(chrome.screen), 5);
        const texts = rowTexts(chrome.screen);
        assert.deepEqual(texts, ["L15", "L16", "L17", "L18", "L19"]);
    });

    it("when HTML is longer than rows and not followLive, keeps the top", () => {
        const term = createTerm(wasm, COLS, ROWS);
        // viewportActive() is true at bottom; stub so pad path uses followLive only.
        term.viewportActive = () => false;
        const chrome = mockChrome(term, { cols: COLS, rows: 5, followLive: false });
        const lines = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n");
        chrome.applyHtml(`<div>${lines}</div>`);
        assert.equal(rowCount(chrome.screen), 5);
        assert.deepEqual(rowTexts(chrome.screen), ["L0", "L1", "L2", "L3", "L4"]);
    });

    it("unwraps formatter outer div and keeps STATUS on the last visual row", () => {
        const term = createTerm(wasm, COLS, ROWS);
        let seq = clearScreen();
        for (let r = 1; r <= 5; r++) seq += cup(r) + `row${r}`;
        seq += cup(ROWS) + "STATUS";
        writeVt(term, seq);

        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS);
        assert.match(rowTexts(chrome.screen)[ROWS - 1], /STATUS/);
    });

    it("extracts palette <style> into paletteStyle", () => {
        const term = createTerm(wasm, COLS, ROWS);
        writeVt(term, clearScreen() + "x");
        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.match(chrome.paletteStyle.textContent, /--vt-palette-/);
        assert.doesNotMatch(chrome.screen.innerHTML, /<style>/i);
    });
});
