import { Pane } from "./pane.js";
import { snapRect } from "./snap.js";

/** One floating Ghostty-like window with tabs. */
export class TermWindow {
    constructor({ desktop, wasm, wsUrl, bounds }) {
        this.desktop = desktop;
        this.wasm = wasm;
        this.wsUrl = wsUrl;
        this.panes = [];
        this.activePane = null;
        this.snapped = null;
        this.restoreBounds = null;
        this.z = 0;

        this.el = desktop.windowTemplate.content.firstElementChild.cloneNode(true);
        this.titlebar = this.el.querySelector(".titlebar");
        this.tabsEl = this.el.querySelector(".tabs");
        this.panesEl = this.el.querySelector(".panes");
        this.plusBtn = this.el.querySelector(".plus");
        this.plusMenu = this.el.querySelector(".plus-menu");
        this.snapBtn = this.el.querySelector(".snap-btn");
        this.snapMenu = this.el.querySelector(".snap-menu");
        this.grip = this.el.querySelector(".resize-grip");

        desktop.el.appendChild(this.el);
        this.setBounds(bounds);
        this.#bindChrome();
        this.addTab();
        this.focus();
        this._ro = new ResizeObserver(() => this.layout());
        this._ro.observe(this.el);
        requestAnimationFrame(() => this.layout());
    }

    get bounds() {
        return {
            x: parseFloat(this.el.style.left) || 0,
            y: parseFloat(this.el.style.top) || 0,
            w: this.el.offsetWidth,
            h: this.el.offsetHeight,
        };
    }

    setBounds({ x, y, w, h }) {
        this.el.style.left = `${Math.round(x)}px`;
        this.el.style.top = `${Math.round(y)}px`;
        this.el.style.width = `${Math.round(w)}px`;
        this.el.style.height = `${Math.round(h)}px`;
        this.layout();
    }

    layout() {
        if (this.el.classList.contains("minimized")) return;
        for (const pane of this.panes) pane.layout();
    }

    focus() {
        this.desktop.raise(this);
        for (const pane of this.panes) {
            pane.ui.windowFocused = pane === this.activePane;
        }
        if (this.activePane) {
            if (this.activePane.pty.open) {
                this.activePane.ui.updateTitle();
                this.activePane.ui.screen.focus();
            } else {
                this.activePane.ui.setDisconnected(true, this.activePane.hadSession);
            }
        }
    }

    addTab() {
        const paneEl = this.desktop.paneTemplate.content.firstElementChild.cloneNode(true);
        const tabEl = this.desktop.tabTemplate.content.firstElementChild.cloneNode(true);
        this.panesEl.appendChild(paneEl);
        this.tabsEl.appendChild(tabEl);

        const pane = new Pane({
            wasm: this.wasm,
            wsUrl: this.wsUrl,
            paneEl,
            tabEl,
            windowEl: this.el,
        });
        this.panes.push(pane);

        tabEl.addEventListener("mousedown", (event) => {
            event.stopPropagation();
            this.focus();
            if (event.target.closest(".tab-close")) {
                event.preventDefault();
                this.closeTab(pane);
                return;
            }
            this.showPane(pane);
        });

        this.showPane(pane);
        this.#syncTabClose();
        requestAnimationFrame(() => this.layout());
        return pane;
    }

    showPane(pane) {
        this.activePane = pane;
        for (const p of this.panes) p.setActive(p === pane, this.desktop.focused === this);
    }

    closeTab(pane) {
        const index = this.panes.indexOf(pane);
        if (index < 0) return;
        if (this.panes.length === 1) {
            this.close();
            return;
        }
        pane.dispose();
        this.panes.splice(index, 1);
        this.showPane(this.panes[Math.max(0, index - 1)]);
        this.#syncTabClose();
    }

    close() {
        this._ro?.disconnect();
        for (const pane of this.panes) pane.dispose();
        this.panes = [];
        this.el.remove();
        this.desktop.removeWindow(this);
    }

    snap(kind) {
        const desk = this.desktop.size();
        const rect = snapRect(kind, desk.w, desk.h);
        if (!rect) return;
        if (!this.snapped) this.restoreBounds = this.bounds;
        this.snapped = kind;
        this.el.classList.toggle("maximized", false);
        this.setBounds(rect);
    }

    relayout() {
        if (this.snapped === "max") {
            const desk = this.desktop.size();
            this.setBounds({ x: 8, y: 8, w: desk.w - 16, h: desk.h - 16 });
            return;
        }
        if (this.snapped) {
            this.snap(this.snapped);
            return;
        }
        this.layout();
    }

    toggleMaximize() {
        const desk = this.desktop.size();
        if (this.snapped === "max") {
            const prev = this.restoreBounds || { x: 48, y: 36, w: 900, h: 560 };
            this.snapped = null;
            this.el.classList.remove("maximized");
            this.setBounds(prev);
            return;
        }
        if (!this.snapped) this.restoreBounds = this.bounds;
        this.snapped = "max";
        this.el.classList.add("maximized");
        this.setBounds({
            x: GAP_MAX, y: GAP_MAX,
            w: desk.w - GAP_MAX * 2,
            h: desk.h - GAP_MAX * 2,
        });
    }

    #syncTabClose() {
        const many = this.panes.length > 1;
        for (const pane of this.panes) {
            pane.tabEl.querySelector(".tab-close").hidden = !many;
        }
    }

    hideMenus() {
        this.plusMenu.hidden = true;
        this.snapMenu.hidden = true;
    }

    #bindChrome() {
        this.el.addEventListener("mousedown", () => this.focus());

        this.titlebar.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            if (event.target.closest("button, .tab, .menu")) return;
            this.desktop.beginDrag(this, event);
        });
        this.titlebar.addEventListener("dblclick", (event) => {
            if (event.target.closest("button, .tab")) return;
            this.toggleMaximize();
        });

        this.el.querySelector(".close").addEventListener("click", (event) => {
            event.stopPropagation();
            this.close();
        });
        this.el.querySelector(".min").addEventListener("click", (event) => {
            event.stopPropagation();
            this.el.classList.toggle("minimized");
            if (!this.el.classList.contains("minimized")) this.layout();
        });
        this.el.querySelector(".max").addEventListener("click", (event) => {
            event.stopPropagation();
            this.toggleMaximize();
        });

        this.plusBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.snapMenu.hidden = true;
            this.plusMenu.hidden = !this.plusMenu.hidden;
        });
        this.plusMenu.addEventListener("click", (event) => {
            const kind = event.target.closest("button")?.dataset.kind;
            if (!kind) return;
            this.hideMenus();
            if (kind === "tab") this.addTab();
            else this.desktop.createWindow();
        });

        this.snapBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.plusMenu.hidden = true;
            this.snapMenu.hidden = !this.snapMenu.hidden;
        });
        this.snapMenu.addEventListener("click", (event) => {
            const kind = event.target.closest("button")?.dataset.snap;
            if (!kind) return;
            this.hideMenus();
            this.snap(kind);
        });

        this.grip.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            this.desktop.beginResize(this, event);
        });
    }
}

const GAP_MAX = 8;
