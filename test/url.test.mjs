import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { urlAtColumn } from "../js/url.js";

describe("urlAtColumn", () => {
    it("finds https URL under the cursor column", () => {
        const line = "see https://example.com/path for docs";
        const hit = urlAtColumn(line, line.indexOf("https"));
        assert.ok(hit);
        assert.equal(hit.url, "https://example.com/path");
        assert.equal(hit.x, line.indexOf("https"));
        assert.equal(hit.len, "https://example.com/path".length);
    });

    it("normalizes www. to https://", () => {
        const line = "www.ghostty.org";
        const hit = urlAtColumn(line, 0);
        assert.equal(hit.url, "https://www.ghostty.org");
    });

    it("returns null when column is outside any URL", () => {
        assert.equal(urlAtColumn("no links here", 3), null);
        assert.equal(urlAtColumn("", 0), null);
    });

    it("trims trailing punctuation from the match span", () => {
        const line = "visit https://example.com.";
        const hit = urlAtColumn(line, 6);
        assert.equal(hit.url, "https://example.com");
        assert.equal(hit.len, "https://example.com".length);
    });
});
