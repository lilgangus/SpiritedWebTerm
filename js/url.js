const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/g;

/**
 * Return the URL match under `col` in a terminal row, if any.
 * `{ url, x, len }` — `x`/`len` are character columns for the trimmed URL.
 */
export function urlAtColumn(line, col) {
    if (!line) return null;
    for (const match of line.matchAll(URL_RE)) {
        const raw = match[0];
        const trimmed = trimUrl(raw);
        const start = match.index;
        const end = start + trimmed.length;
        if (col >= start && col < end) {
            return { url: normalizeUrl(raw), x: start, len: trimmed.length };
        }
    }
    return null;
}

function trimUrl(raw) {
    return raw.replace(/[.,;:!?)}\]'"]+$/, "");
}

function normalizeUrl(raw) {
    const trimmed = trimUrl(raw);
    if (trimmed.startsWith("www.")) return `https://${trimmed}`;
    return trimmed;
}

/** Open an http(s) URL in a new tab. Returns false for invalid or unsafe schemes. */
export function openUrl(raw) {
    if (!raw) return false;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    window.open(url.href, "_blank", "noopener,noreferrer");
    return true;
}
