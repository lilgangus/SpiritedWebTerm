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

    createWindow() {
        const desk = this.size();
        const w = Math.min(920, Math.max(480, desk.w - 96));
        const h = Math.min(580, Math.max(320, desk.h - 96));
        const offset = (this.cascade++ % 8) * 28;
        const x = Math.max(16, Math.min((desk.w - w) / 2 + offset, desk.w - w - 16));
        const y = Math.max(16, Math.min((desk.h - h) / 2 + offset, desk.h - h - 16));
        const win = new TermWindow({
            desktop: this,
            wasm: this.wasm,
            wsUrl: this.wsUrl,
            bounds: { x, y, w, h },
        });
        this.windows.push(win);
        this.emptyBtn.hidden = true;
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
        if (win.el.classList.contains("minimized")) return;
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
        if (win.el.classList.contains("minimized")) return;
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

    #onMove(event) {
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
