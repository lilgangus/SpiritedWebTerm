import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Wasm } from "../js/wasm.js";
import { Terminal } from "../js/terminal.js";
import { Chrome } from "../js/chrome.js";
import * as C from "../js/constants.js";

export { C };

/** DEC private mode 1049 (alt screen + save cursor). Packed value == mode number. */
export const MODE_ALT_SCREEN_SAVE = 1049;

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_ROOT = join(HERE, "..");
export const REPO_ROOT = join(EXAMPLE_ROOT, "../..");
export const DEFAULT_WASM = join(REPO_ROOT, "zig-out/bin/ghostty-vt.wasm");
export const TESTDATA = join(EXAMPLE_ROOT, "testdata");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Load ghostty-vt.wasm from disk (Node has no file:// fetch). */
export async function loadWasm(path = DEFAULT_WASM) {
    const bytes = await readFile(path);
    let instance;
    const result = await WebAssembly.instantiate(bytes, {
        env: {
            log: (ptr, len) => {
                const heap = new Uint8Array(instance.exports.memory.buffer, ptr, len);
                console.error("[wasm]", decoder.decode(heap));
            },
        },
    });
    instance = result.instance;
    const jsonPtr = instance.exports.ghostty_type_json();
    const json = decoder
        .decode(new Uint8Array(
            instance.exports.memory.buffer,
            jsonPtr,
            Math.min(1 << 20, instance.exports.memory.buffer.byteLength - jsonPtr),
        ))
        .split("\0")[0];
    return new Wasm(instance, JSON.parse(json));
}

export function createTerm(wasm, cols = 80, rows = 40) {
    const term = new Terminal(wasm, cols, rows);
    term.create();
    return term;
}

export function writeVt(term, bytes) {
    if (typeof bytes === "string") bytes = encoder.encode(bytes);
    term.write(bytes);
}

/** 1-based CUP. */
export function cup(row, col = 1) {
    return `\x1b[${row};${col}H`;
}

export function clearScreen() {
    return "\x1b[2J\x1b[H";
}

/** Strip tags / entities enough to read VT cell text. */
export function stripHtml(html) {
    return html
        .replace(/<style>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/\u00a0/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

/** Plain text lines from formatter HTML (style removed, no pad). */
export function formatLines(html) {
    let body = html;
    const start = html.indexOf("<style>");
    const end = html.indexOf("</style>");
    if (start !== -1 && end !== -1) {
        body = (html.slice(0, start) + html.slice(end + 8)).trim();
    }
    const open = body.match(/^<div\b[^>]*>/i);
    if (open) {
        body = body.slice(open[0].length);
        if (body.endsWith("</div>")) body = body.slice(0, -"</div>".length);
    }
    const lines = body.length ? body.split("\n") : [];
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line) => stripHtml(line));
}

/**
 * Minimal Chrome stand-in that can run applyHtml without a browser DOM.
 * Only the fields applyHtml / render-sync need are wired.
 */
export function mockChrome(term, { cols, rows, followLive = true } = {}) {
    const screen = {
        id: "screen-test",
        innerHTML: "",
        scrollTop: 0,
    };
    const chrome = Object.create(Chrome.prototype);
    chrome.term = term;
    chrome.pty = { resize() {}, open: false };
    chrome.cols = cols ?? term.cols;
    chrome.rows = rows ?? term.rows;
    chrome.cellW = 8;
    chrome.cellH = 17;
    chrome.followLive = followLive;
    chrome.screen = screen;
    chrome.paletteStyle = { textContent: "" };
    chrome._vars = {};
    chrome._setVar = (name, value) => {
        chrome._vars[name] = value;
    };
    return chrome;
}

/** Text content of each `.row` after applyHtml. */
export function rowTexts(screenEl) {
    const matches = [...screenEl.innerHTML.matchAll(/<div class="row">(.*?)<\/div>/gs)];
    return matches.map((m) => stripHtml(m[1]).replace(/\s+$/g, ""));
}

export function rowCount(screenEl) {
    return (screenEl.innerHTML.match(/class="row"/g) || []).length;
}

/** Keep WASM size locked to chrome cols/rows (mirrors Chrome.render sync). */
export function syncSize(chrome) {
    const wasmCols = chrome.term.cellCountData(C.DATA_COLS);
    const wasmRows = chrome.term.cellCountData(C.DATA_ROWS);
    if ((wasmCols && wasmCols !== chrome.cols) || (wasmRows && wasmRows !== chrome.rows)) {
        chrome.cols = Math.max(20, chrome.cols);
        chrome.rows = Math.max(8, chrome.rows);
        chrome.term.resize(chrome.cols, chrome.rows, chrome.cellW, chrome.cellH);
    }
}

export function paint(chrome) {
    syncSize(chrome);
    chrome.applyHtml(chrome.term.formatHtml());
}

export async function readFixture(name) {
    return readFile(join(TESTDATA, name));
}
