import * as C from "./constants.js";

/** Window chrome: screen HTML, cursor, scrollbar, title, bell, cell metrics. */
export class Chrome {
    constructor({ term, pty }) {
        this.term = term;
        this.pty = pty;
        this.followLive = true;
        this.fontSize = 13;
        this.cellW = 8;
        this.cellH = 17;
        this.cols = 80;
        this.rows = 24;
        this.renderQueued = false;
        this.drag = null;
        this.lastScrollbar = { total: 24, offset: 0, len: 24 };

        this.screen = document.getElementById("screen");
        this.wrap = document.getElementById("screen-wrap");
        this.cursorEl = document.getElementById("cursor");
        this.thumb = document.getElementById("thumb");
        this.track = document.getElementById("scrollbar");
        this.paletteStyle = document.getElementById("vt-palette");
    }

    jumpToLive() {
        this.followLive = true;
        if (!this.term.viewportActive()) this.term.scroll(C.SCROLL_BOTTOM);
    }

    onFontChord(kind) {
        const next = kind === "inc" ? this.fontSize + 1
            : kind === "dec" ? this.fontSize - 1 : 13;
        this.fontSize = Math.max(8, Math.min(32, next));
        document.documentElement.style.setProperty("--font-size", `${this.fontSize}px`);
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
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
        this.wrap.appendChild(probe);
        const rect = probe.getBoundingClientRect();
        this.cellW = rect.width / 80 || 8;
        this.cellH = rect.height || this.fontSize * 1.35;
        this.wrap.removeChild(probe);
        document.documentElement.style.setProperty("--cell-w", `${this.cellW}px`);
        document.documentElement.style.setProperty("--cell-h", `${this.cellH}px`);
    }

    resizeToFit() {
        const nextCols = Math.max(20, Math.floor((this.wrap.clientWidth - 16) / this.cellW));
        const nextRows = Math.max(8, Math.floor((this.wrap.clientHeight - 16) / this.cellH));
        document.documentElement.style.setProperty("--cols", String(nextCols));
        document.documentElement.style.setProperty("--rows", String(nextRows));
        if (nextCols === this.cols && nextRows === this.rows) return;
        this.cols = nextCols;
        this.rows = nextRows;
        this.term.resize(this.cols, this.rows, this.cellW, this.cellH);
        this.pty.resize(this.cols, this.rows);
        this.render();
    }

    flashBell() {
        const el = document.getElementById("bell");
        el.classList.add("on");
        setTimeout(() => el.classList.remove("on"), 90);
    }

    updateTitle() {
        const title = this.term.title();
        document.getElementById("tab").textContent = title;
        document.getElementById("title").textContent = title;
        document.title = title;
    }

    updateColors() {
        const bg = this.term.rgb(C.DATA_COLOR_BG) || { r: 0x28, g: 0x2c, b: 0x34 };
        const fg = this.term.rgb(C.DATA_COLOR_FG) || { r: 0xff, g: 0xff, b: 0xff };
        const cursor = this.term.rgb(C.DATA_COLOR_CURSOR) || fg;
        const root = document.documentElement.style;
        root.setProperty("--bg", `rgb(${bg.r}, ${bg.g}, ${bg.b})`);
        root.setProperty("--fg", `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
        root.setProperty("--cursor", `rgb(${cursor.r}, ${cursor.g}, ${cursor.b})`);
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
        const scoped = html.replaceAll(":root", "#screen");
        const start = scoped.indexOf("<style>");
        const end = scoped.indexOf("</style>");
        let body = scoped;
        if (start !== -1 && end !== -1) {
            this.paletteStyle.textContent = scoped.slice(start + 7, end);
            body = (scoped.slice(0, start) + scoped.slice(end + 8)).trim();
        }
        this.screen.innerHTML = body;
        // If HTML is taller than the viewport (full scrollback dump, extra
        // newline, leftover style), show the live bottom — not the oldest rows.
        if (this.term.viewportActive()) {
            this.screen.scrollTop = this.screen.scrollHeight;
        } else {
            this.screen.scrollTop = 0;
        }
    }

    render() {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            try {
                this.applyHtml(this.term.formatHtml());
                this.updateColors();
                this.updateTitle();
                this.updateCursor(this.term.cursor());
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
