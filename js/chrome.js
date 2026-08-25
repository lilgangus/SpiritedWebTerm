import * as C from "./constants.js";

let nextScreenId = 1;

/** Pane chrome: screen HTML, cursor, scrollbar, title, bell, cell metrics. */
export class Chrome {
    constructor({ term, pty, pane, windowEl, tabEl }) {
        this.term = term;
        this.pty = pty;
        this.pane = pane;
        this.windowEl = windowEl;
        this.tabEl = tabEl;
        this.active = false;
        this.windowFocused = false;
        this.readonly = false;
        this.followLive = true;
        this.fontSize = 13;
        this.cellW = 8;
        this.cellH = 17;
        this.cols = 80;
        this.rows = 24;
        this.renderQueued = false;
        this.selecting = false;
        this.pendingRender = false;
        this.ignoreWheelUntil = 0;
        this.lastHtmlSig = "";
        this.drag = null;
        this.lastScrollbar = { total: 24, offset: 0, len: 24 };
        this.lastScrollTotal = 24;

        this.screen = pane.querySelector(".screen");
        this.wrap = pane.querySelector(".screen-wrap");
        this.cursorEl = pane.querySelector(".cursor");
        this.thumb = pane.querySelector(".thumb");
        this.track = pane.querySelector(".scrollbar");
        this.paletteStyle = pane.querySelector(".vt-palette");
        this.overlay = pane.querySelector(".session-overlay");
        this.openButton = pane.querySelector(".open-session");
        this.viewButton = pane.querySelector(".view-session");
        this.bellEl = pane.querySelector(".bell");
        this.tabLabel = tabEl.querySelector(".tab-label");
        this.titleEl = windowEl.querySelector(".win-title");

        this.screen.id = `screen-${nextScreenId++}`;
        this._setVar("--font-size", `${this.fontSize}px`);
    }

    _setVar(name, value) {
        this.pane.style.setProperty(name, value);
        if (this.active && (name === "--bg" || name === "--fg" || name === "--cursor")) {
            this.windowEl.style.setProperty(name, value);
        }
    }

    setWindow(windowEl) {
        this.windowEl = windowEl;
        this.titleEl = windowEl.querySelector(".win-title");
    }

    setDisconnected(disconnected, hadSession = false) {
        if (!disconnected) {
            this.readonly = false;
            this.overlay.classList.add("hidden");
            this.viewButton.hidden = true;
            this.openButton.disabled = false;
            this.viewButton.disabled = false;
            return;
        }
        this.openButton.textContent = hadSession ? "New Terminal" : "Open Terminal";
        this.viewButton.hidden = !hadSession;
        this.cursorEl.classList.remove("visible");
        this.openButton.disabled = false;
        this.viewButton.disabled = false;
        if (this.readonly && hadSession) {
            this.overlay.classList.add("hidden");
            this.updateTitle();
            return;
        }
        this.readonly = false;
        this.overlay.classList.remove("hidden");
        const label = hadSession ? "Disconnected" : "Ghostty";
        this.tabLabel.textContent = label;
        if (this.active) {
            this.titleEl.textContent = label;
            if (this.windowFocused) document.title = label;
        }
        if (this.active) this.openButton.focus();
    }

    viewLogs() {
        this.readonly = true;
        this.overlay.classList.add("hidden");
        this.cursorEl.classList.remove("visible");
        this.updateTitle();
        this.render();
        this.screen.focus();
    }

    exitViewLogs() {
        if (!this.readonly) return;
        this.readonly = false;
        this.setDisconnected(true, true);
    }

    prepareConnect() {
        this.readonly = false;
        this.openButton.disabled = true;
        this.viewButton.disabled = true;
    }

    jumpToLive() {
        this.followLive = true;
        this.selecting = false;
        this.pendingRender = false;
        this.ignoreWheelUntil = performance.now() + 150;
        if (!this.term.viewportActive()) this.term.scroll(C.SCROLL_BOTTOM);
        this.lastHtmlSig = "";
        this.lastScrollTotal = 0;
        this.render();
    }

    hasDomSelection() {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed) return false;
        return this.screen.contains(sel.anchorNode) || this.screen.contains(sel.focusNode);
    }

    beginSelecting() {
        this.selecting = true;
    }

    endSelecting() {
        this.selecting = false;
        if (this.pendingRender) {
            this.pendingRender = false;
            this.render();
        }
    }

    onFontChord(kind) {
        const next = kind === "inc" ? this.fontSize + 1
            : kind === "dec" ? this.fontSize - 1 : 13;
        this.fontSize = Math.max(8, Math.min(32, next));
        this._setVar("--font-size", `${this.fontSize}px`);
        this.measureCells();
        this.resizeToFit();
    }

    mousePos(event) {
        const rect = this.wrap.getBoundingClientRect();
        return { x: event.clientX - rect.left - 8, y: event.clientY - rect.top - 8 };
    }

    measureCells() {
        const probe = document.createElement("span");
        probe.textContent = "M".repeat(80);
        probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:pre;line-height:normal;";
        this.wrap.appendChild(probe);
        const rect = probe.getBoundingClientRect();
        this.cellW = rect.width / 80 || 8;
        this.cellH = Math.max(1, Math.round(rect.height) || Math.round(this.fontSize * 1.35));
        this.wrap.removeChild(probe);
        this._setVar("--cell-w", `${this.cellW}px`);
        this._setVar("--cell-h", `${this.cellH}px`);
    }

    resizeToFit() {
        if (this.wrap.clientWidth < 16 || this.wrap.clientHeight < 16) return;
        const nextCols = Math.max(20, Math.floor((this.wrap.clientWidth - 16) / this.cellW));
        const nextRows = Math.max(8, Math.floor((this.wrap.clientHeight - 16) / this.cellH));
        this._setVar("--cols", String(nextCols));
        this._setVar("--rows", String(nextRows));
        if (nextCols === this.cols && nextRows === this.rows) return;
        this.cols = nextCols;
        this.rows = nextRows;
        this.term.resize(this.cols, this.rows, this.cellW, this.cellH);
        this.pty.resize(this.cols, this.rows);
        this.render();
    }

    flashBell() {
        this.bellEl.classList.add("on");
        setTimeout(() => this.bellEl.classList.remove("on"), 90);
    }

    updateTitle() {
        const title = this.term.title();
        this.tabLabel.textContent = title;
        if (!this.active) return;
        this.titleEl.textContent = title;
        if (this.windowFocused) document.title = title;
    }

    updateColors() {
        const bg = this.term.rgb(C.DATA_COLOR_BG) || { r: 0x28, g: 0x2c, b: 0x34 };
        const fg = this.term.rgb(C.DATA_COLOR_FG) || { r: 0xff, g: 0xff, b: 0xff };
        const cursor = this.term.rgb(C.DATA_COLOR_CURSOR) || fg;
        this._setVar("--bg", `rgb(${bg.r}, ${bg.g}, ${bg.b})`);
        this._setVar("--fg", `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
        this._setVar("--cursor", `rgb(${cursor.r}, ${cursor.g}, ${cursor.b})`);
    }

    updateCursor(cursor) {
        if (!cursor.visible) {
            this.cursorEl.classList.remove("visible");
            return;
        }
        this.cursorEl.style.transform = `translate(${cursor.x * this.cellW}px, ${cursor.y * this.cellH}px)`;
        this.cursorEl.classList.toggle("blink", this.term.mode(C.MODE_CURSOR_BLINK));
        this.cursorEl.classList.remove("visible");
        this.cursorEl.classList.add("blink-reset");
        void this.cursorEl.offsetWidth;
        this.cursorEl.classList.remove("blink-reset");
        this.cursorEl.classList.add("visible");
    }

    updateScrollbar(state) {
        this.lastScrollbar = state;
        const trackH = this.track.clientHeight || 1;
        const total = Math.max(state.total, state.len, 1);
        const visible = Math.min(Math.max(state.len, 1), total);
        const maxOffset = Math.max(total - visible, 0);
        const thumbH = Math.max(18, Math.round((visible / total) * trackH));
        const travel = Math.max(trackH - thumbH, 0);
        const top = maxOffset === 0 ? 0 : Math.round((state.offset / maxOffset) * travel);
        this.thumb.style.height = `${thumbH}px`;
        this.thumb.style.top = `${top}px`;
        this.thumb.style.display = maxOffset === 0 ? "none" : "block";
    }

    applyHtml(html) {
        const scoped = html.replaceAll(":root", `#${this.screen.id}`);
        const start = scoped.indexOf("<style>");
        const end = scoped.indexOf("</style>");
        let body = scoped;
        if (start !== -1 && end !== -1) {
            this.paletteStyle.textContent = scoped.slice(start + 7, end);
            body = (scoped.slice(0, start) + scoped.slice(end + 8)).trim();
        }

        let inner = body;
        const open = body.match(/^<div\b[^>]*>/i);
        if (open) {
            inner = body.slice(open[0].length);
            if (inner.endsWith("</div>")) inner = inner.slice(0, -"</div>".length);
        }

        // Formatter emits nested <div style="display:inline"> runs. Keep them as
        // spans so per-row block layout cannot inflate row height and clip the
        // live bottom line once the screen is full.
        inner = inner
            .replace(/<div\b([^>]*)>/gi, "<span$1>")
            .replace(/<\/div>/gi, "</span>");

        const sb = this.term.scrollbar();
        // Match the CSS grid height (this.rows), not just the VT row count.
        const vtRows = Math.max(1, this.rows);
        const live = this.followLive || this.term.pinnedBottom() || this.term.viewportActive();

        let lines = inner.length ? inner.split("\n") : [];
        // A trailing newline from the formatter becomes an extra empty row and
        // shifts the live line out of the clipped viewport.
        if (lines.length && lines[lines.length - 1] === "") lines.pop();

        if (lines.length > vtRows) {
            lines = live ? lines.slice(lines.length - vtRows) : lines.slice(0, vtRows);
        }
        while (lines.length < vtRows) {
            // When pinned to live, the formatter often omits the trailing empty
            // row at the first scrollback line (e.g. git push from a full screen).
            if (live) lines.push("");
            else lines.unshift("");
        }

        const next = lines.map((line) => `<div class="row">${line || "\u00a0"}</div>`).join("");
        const force = sb.total !== this.lastScrollTotal;
        this.lastScrollTotal = sb.total;
        const sig = `${sb.total}:${sb.offset}:${live}:${next}`;
        if (!force && sig === this.lastHtmlSig) return;
        this.lastHtmlSig = sig;
        this.screen.innerHTML = next;
        this.screen.classList.toggle("follow-live", live);
        // Always keep DOM scroll at top; row grid already maps 1:1 to the viewport.
        this.screen.scrollTop = 0;
    }

    render() {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            if (this.selecting || this.hasDomSelection()) {
                this.pendingRender = true;
                return;
            }
            try {
                const live = this.followLive || this.term.pinnedBottom() || this.term.viewportActive();
                if (this.followLive && !this.term.pinnedBottom()) {
                    this.term.scroll(C.SCROLL_BOTTOM);
                    this.lastHtmlSig = "";
                }
                this.applyHtml(this.term.formatHtml({ live }));
                this.updateColors();
                if (this.pty.open) {
                    this.updateTitle();
                    this.updateCursor(this.term.cursor());
                } else {
                    this.cursorEl.classList.remove("visible");
                    if (this.readonly) this.updateTitle();
                }
                this.updateScrollbar(this.term.scrollbar());
            } catch (err) {
                console.error(err);
            }
        });
    }

    bindScrollbar() {
        this.track.addEventListener("mousedown", (event) => {
            if (event.target === this.thumb) {
                const rect = this.thumb.getBoundingClientRect();
                this.drag = { anchor: (event.clientY - rect.top) / Math.max(rect.height, 1) };
                this.thumb.classList.add("dragging");
                event.preventDefault();
                return;
            }
            this.scrollFromTrack(event.clientY, 0.5);
            event.preventDefault();
        });
        window.addEventListener("mousemove", (event) => {
            if (this.drag) this.scrollFromTrack(event.clientY, this.drag.anchor);
        });
        window.addEventListener("mouseup", () => {
            if (!this.drag) return;
            this.drag = null;
            this.thumb.classList.remove("dragging");
        });
        this.track.addEventListener("wheel", (event) => {
            event.preventDefault();
            if (this.ignoreWheelUntil && performance.now() < this.ignoreWheelUntil) return;
            const maxOffset = Math.max(this.lastScrollbar.total - this.lastScrollbar.len, 0);
            if (maxOffset === 0) return;
            this.followLive = false;
            const lines = Math.max(1, Math.round(Math.abs(event.deltaY) / 40));
            this.term.scroll(C.SCROLL_DELTA, event.deltaY < 0 ? -lines : lines);
            this.render();
        }, { passive: false });
    }

    scrollFromTrack(clientY, thumbAnchor = 0.5) {
        const rect = this.track.getBoundingClientRect();
        const trackH = rect.height || 1;
        const total = Math.max(this.lastScrollbar.total, this.lastScrollbar.len, 1);
        const visible = Math.min(Math.max(this.lastScrollbar.len, 1), total);
        const maxOffset = Math.max(total - visible, 0);
        this.followLive = false;
        if (maxOffset === 0) {
            this.term.scroll(C.SCROLL_BOTTOM);
            this.render();
            return;
        }
        const thumbH = Math.max(18, (visible / total) * trackH);
        const travel = Math.max(trackH - thumbH, 0);
        const y = clientY - rect.top - thumbH * thumbAnchor;
        const ratio = travel === 0 ? 1 : Math.min(1, Math.max(0, y / travel));
        this.term.scroll(C.SCROLL_ROW, Math.round(ratio * maxOffset));
        this.render();
    }
}
