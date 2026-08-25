import { TermWindow } from "./window.js";
import { hitSnap, snapRect } from "./snap.js";

const MIN_DRAG = 8;

/** Desktop that owns floating terminal windows. */
export class Desktop {
    constructor({ el, wasm, wsUrl, windowTemplate, tabTemplate, paneTemplate }) {
        this.el = el;
        this.wasm = wasm;
        this.wsUrl = wsUrl;
        this.windowTemplate = windowTemplate;
        this.tabTemplate = tabTemplate;
        this.paneTemplate = paneTemplate;
        this.preview = el.querySelector("#snap-preview");
        this.emptyBtn = el.querySelector("#desktop-new");
        this.windows = [];
        this.focused = null;
        this.z = 10;
        this.cascade = 0;
        this._drag = null;
        this._resize = null;
        this._tabDrag = null;

        this.emptyBtn.addEventListener("click", () => this.createWindow());
        window.addEventListener("pointermove", (event) => this.#onMove(event));
        window.addEventListener("pointerup", (event) => this.#onUp(event));
        window.addEventListener("resize", () => {
            for (const win of this.windows) win.relayout();
        });
        document.addEventListener("pointerdown", (event) => {
            for (const win of this.windows) {
                if (!win.el.contains(event.target)) win.hideMenus();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                for (const win of this.windows) win.hideMenus();
                this.#cancelTabDrag();
            }
        });
    }

    size() {
        return { w: this.el.clientWidth, h: this.el.clientHeight };
    }

    pointer(event) {
        const rect = this.el.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    createWindow({ pane = null, bounds = null, empty = false } = {}) {
        const desk = this.size();
        let rect = bounds;
        if (!rect) {
            const w = Math.min(920, Math.max(480, desk.w - 96));
            const h = Math.min(580, Math.max(320, desk.h - 96));
            const offset = (this.cascade++ % 8) * 28;
            const x = Math.max(16, Math.min((desk.w - w) / 2 + offset, desk.w - w - 16));
            const y = Math.max(16, Math.min((desk.h - h) / 2 + offset, desk.h - h - 16));
            rect = { x, y, w, h };
        }
        const win = new TermWindow({
            desktop: this,
            wasm: this.wasm,
            wsUrl: this.wsUrl,
            bounds: rect,
            empty: empty || !!pane,
        });
        this.windows.push(win);
        this.emptyBtn.hidden = true;
        if (pane) win.insertPane(pane, 0);
        this.raise(win);
        return win;
    }

    removeWindow(win) {
        this.windows = this.windows.filter((w) => w !== win);
        if (this.focused === win) this.focused = this.windows[this.windows.length - 1] || null;
        if (this.focused) this.raise(this.focused);
        this.emptyBtn.hidden = this.windows.length > 0;
    }

    raise(win) {
        win.z = ++this.z;
        win.el.style.zIndex = String(win.z);
        win.el.classList.add("focused");
        this.focused = win;
        for (const other of this.windows) {
            if (other !== win) other.el.classList.remove("focused");
        }
    }

    beginDrag(win, event) {
        if (this._tabDrag || win.el.classList.contains("minimized")) return;
        this.raise(win);
        win.hideMenus();
        const b = win.bounds;
        const pt = this.pointer(event);
        this._drag = {
            win,
            dx: pt.x - b.x,
            dy: pt.y - b.y,
            startX: pt.x,
            startY: pt.y,
            moved: false,
        };
        win.el.classList.add("dragging");
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    beginResize(win, event) {
        if (this._tabDrag || win.el.classList.contains("minimized")) return;
        this.raise(win);
        win.hideMenus();
        const b = win.bounds;
        const pt = this.pointer(event);
        this._resize = {
            win,
            x: pt.x,
            y: pt.y,
            w: b.w,
            h: b.h,
        };
        win.snapped = null;
        win.el.classList.remove("maximized");
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    beginTabDrag(fromWin, pane, event) {
        if (this._drag || this._resize) return;
        fromWin.hideMenus();
        this._tabDrag = {
            fromWin,
            pane,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - pane.tabEl.getBoundingClientRect().left,
            offsetY: event.clientY - pane.tabEl.getBoundingClientRect().top,
            moved: false,
            ghost: null,
            drop: null,
        };
        event.preventDefault();
    }

    #onMove(event) {
        if (this._tabDrag) {
            this.#onTabMove(event);
            return;
        }
        const desk = this.size();
        const pt = this.pointer(event);
        if (this._drag) {
            const { win } = this._drag;
            if (Math.hypot(pt.x - this._drag.startX, pt.y - this._drag.startY) >= MIN_DRAG) {
                this._drag.moved = true;
            }
            if (win.snapped) {
                win.snapped = null;
                win.el.classList.remove("maximized");
                const prev = win.restoreBounds || win.bounds;
                win.el.style.width = `${prev.w}px`;
                win.el.style.height = `${prev.h}px`;
                this._drag.dx = Math.min(Math.max(24, this._drag.dx), Math.max(24, prev.w - 24));
            }
            const x = Math.round(pt.x - this._drag.dx);
            const y = Math.round(Math.max(0, pt.y - this._drag.dy));
            win.el.style.left = `${x}px`;
            win.el.style.top = `${y}px`;
            if (this._drag.moved) this.#preview(hitSnap(pt.x, pt.y, desk.w, desk.h), desk);
            return;
        }
        if (this._resize) {
            const { win, x, y, w, h } = this._resize;
            win.setBounds({
                x: win.bounds.x,
                y: win.bounds.y,
                w: Math.max(360, w + (pt.x - x)),
                h: Math.max(220, h + (pt.y - y)),
            });
        }
    }

    #onUp(event) {
        if (this._tabDrag) {
            this.#onTabUp(event);
            return;
        }
        if (this._drag) {
            const { win, moved } = this._drag;
            win.el.classList.remove("dragging");
            const desk = this.size();
            const pt = this.pointer(event);
            this.preview.classList.remove("on");
            const zone = moved ? hitSnap(pt.x, pt.y, desk.w, desk.h) : null;
            if (zone) win.snap(zone);
            else win.layout();
            this._drag = null;
            return;
        }
        this._resize = null;
    }

    #onTabMove(event) {
        const drag = this._tabDrag;
        if (!drag) return;
        const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.moved && dist < MIN_DRAG) return;
        if (!drag.moved) {
            drag.moved = true;
            drag.pane.tabEl.classList.add("dragging");
            drag.ghost = this.#makeTabGhost(drag.pane);
            this.el.appendChild(drag.ghost);
        }
        drag.ghost.style.left = `${Math.round(event.clientX - drag.offsetX)}px`;
        drag.ghost.style.top = `${Math.round(event.clientY - drag.offsetY)}px`;
        this.#setTabDrop(this.#hitTabDrop(event.clientX, event.clientY, drag));
    }

    #onTabUp(event) {
        const drag = this._tabDrag;
        if (!drag) return;
        const drop = drag.moved
            ? this.#hitTabDrop(event.clientX, event.clientY, drag)
            : null;
        this.#clearTabDrop();
        drag.pane.tabEl.classList.remove("dragging");
        drag.ghost?.remove();
        this._tabDrag = null;

        if (!drag.moved || !drop) return;

        const { fromWin, pane } = drag;
        if (drop.kind === "reorder") {
            fromWin.reorderPane(pane, drop.index);
            fromWin.showPane(pane);
            return;
        }
        if (drop.kind === "window") {
            if (drop.win === fromWin) {
                fromWin.reorderPane(pane, drop.index);
                fromWin.showPane(pane);
                return;
            }
            fromWin.releasePane(pane);
            drop.win.insertPane(pane, drop.index);
            fromWin.closeIfEmpty();
            this.raise(drop.win);
            return;
        }
        if (drop.kind === "new") {
            const desk = this.size();
            const w = Math.min(920, Math.max(480, fromWin.bounds.w));
            const h = Math.min(580, Math.max(320, fromWin.bounds.h));
            const x = Math.max(16, Math.min(drop.x - 80, desk.w - w - 16));
            const y = Math.max(16, Math.min(drop.y - 16, desk.h - h - 16));
            fromWin.releasePane(pane);
            this.createWindow({ pane, bounds: { x, y, w, h } });
            fromWin.closeIfEmpty();
        }
    }

    #cancelTabDrag() {
        const drag = this._tabDrag;
        if (!drag) return;
        this.#clearTabDrop();
        drag.pane.tabEl.classList.remove("dragging");
        drag.ghost?.remove();
        this._tabDrag = null;
    }

    #makeTabGhost(pane) {
        const ghost = document.createElement("div");
        ghost.className = "tab-ghost";
        ghost.textContent = pane.tabEl.querySelector(".tab-label")?.textContent || "Ghostty";
        const rect = pane.tabEl.getBoundingClientRect();
        ghost.style.width = `${Math.round(rect.width)}px`;
        return ghost;
    }

    #hitTabDrop(clientX, clientY, drag) {
        const stack = document.elementsFromPoint(clientX, clientY);
        for (const el of stack) {
            if (el === drag.ghost || el === drag.pane.tabEl) continue;
            const tab = el.closest?.(".tab");
            if (tab) {
                const win = this.windows.find((w) => w.tabsEl.contains(tab));
                if (!win) continue;
                const pane = win.panes.find((p) => p.tabEl === tab);
                if (!pane || pane === drag.pane) continue;
                const rect = tab.getBoundingClientRect();
                const before = clientX < rect.left + rect.width / 2;
                const index = win.panes.indexOf(pane) + (before ? 0 : 1);
                return { kind: win === drag.fromWin ? "reorder" : "window", win, index, tab, before };
            }
            if (el.classList?.contains("tabs") || el.classList?.contains("tab-add")) {
                const win = this.windows.find((w) => w.tabsEl === el || w.tabsEl.contains(el));
                if (!win) continue;
                return {
                    kind: win === drag.fromWin ? "reorder" : "window",
                    win,
                    index: win.panes.length,
                    end: true,
                };
            }
            const windowEl = el.closest?.(".window");
            if (windowEl) {
                const win = this.windows.find((w) => w.el === windowEl);
                if (!win) continue;
                if (win === drag.fromWin) return null;
                return { kind: "window", win, index: win.panes.length, end: true };
            }
        }
        const pt = this.pointer({ clientX, clientY });
        return { kind: "new", x: pt.x, y: pt.y };
    }

    #setTabDrop(drop) {
        this.#clearTabDrop();
        this._tabDrop = drop;
        if (!drop) return;
        if (drop.tab && drop.before) drop.tab.classList.add("drop-before");
        else if (drop.tab && !drop.before) drop.tab.classList.add("drop-after");
        else if (drop.win && drop.end) {
            drop.win.tabsEl.classList.add("drop-end");
            drop.win.tabsEl.classList.add("drop-target");
        } else if (drop.win) {
            drop.win.tabsEl.classList.add("drop-target");
        }
    }

    #clearTabDrop() {
        for (const win of this.windows) {
            win.tabsEl.classList.remove("drop-end", "drop-target");
            for (const pane of win.panes) {
                pane.tabEl.classList.remove("drop-before", "drop-after");
            }
        }
        this._tabDrop = null;
    }

    #preview(zone, desk) {
        if (!zone) {
            this.preview.classList.remove("on");
            return;
        }
        const rect = snapRect(zone, desk.w, desk.h);
        this.preview.style.left = `${rect.x}px`;
        this.preview.style.top = `${rect.y}px`;
        this.preview.style.width = `${rect.w}px`;
        this.preview.style.height = `${rect.h}px`;
        this.preview.classList.add("on");
    }
}
