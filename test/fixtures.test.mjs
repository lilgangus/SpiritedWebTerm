import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
    MODE_ALT_SCREEN_SAVE,
    loadWasm,
    createTerm,
    writeVt,
    readFixture,
    mockChrome,
    paint,
    rowTexts,
    rowCount,
} from "./helpers.mjs";

const COLS = 80;
const ROWS = 24;

describe("VT fixtures (integration)", () => {
    /** @type {import("../js/wasm.js").Wasm} */
    let wasm;

    before(async () => {
        wasm = await loadWasm();
    });

    async function runFixture(name, { expectAlt, lastRowRe, also } = {}) {
        const term = createTerm(wasm, COLS, ROWS);
        writeVt(term, await readFixture(name));
        if (expectAlt !== undefined) {
            assert.equal(term.mode(MODE_ALT_SCREEN_SAVE), expectAlt);
        }
        const chrome = mockChrome(term, { cols: COLS, rows: ROWS });
        paint(chrome);
        assert.equal(rowCount(chrome.screen), ROWS, `${name}: dom row count`);
        if (lastRowRe) {
            assert.match(rowTexts(chrome.screen)[ROWS - 1], lastRowRe, `${name}: last row`);
        }
        also?.(term, chrome);
    }

    it("vim-open-status.vt", async () => {
        await runFixture("vim-open-status.vt", {
            expectAlt: true,
            lastRowRe: /STATUS/,
        });
    });

    it("less-git-log.vt", async () => {
        await runFixture("less-git-log.vt", {
            expectAlt: true,
            lastRowRe: /\(END\)/,
        });
    });

    it("git-push-last-line.vt", async () => {
        await runFixture("git-push-last-line.vt", {
            expectAlt: false,
            lastRowRe: /Writing objects:\s*100%/,
            also: (_term, chrome) => {
                assert.match(rowTexts(chrome.screen)[0], /fill 1/);
            },
        });
    });

    it("exit-alt-restore.vt", async () => {
        await runFixture("exit-alt-restore.vt", {
            expectAlt: false,
            also: (_term, chrome) => {
                const joined = rowTexts(chrome.screen).join("\n");
                assert.match(joined, /shell-prompt/);
                assert.doesNotMatch(joined, /ALT_ONLY/);
            },
        });
    });
});
