import { Pane } from "./pane.js";
import { snapRect } from "./snap.js";

/** One floating Ghostty-like window with tabs. */
export class TermWindow {
    constructor({ desktop, wasm, wsUrl, bounds, empty = false }) {
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
        this.tabAddBtn = this.el.querySelector(".tab-add");
        this.panesEl = this.el.querySelector(".panes");
        this.plusBtn = this.el.querySelector(".plus");
        this.maxMenu = this.el.querySelector(".max-menu");
        this.grip = this.el.querySelector(".resize-grip");

        desktop.el.appendChild(this.el);
        this.setBounds(bounds);
        this.#bindChrome();
        if (!empty) this.addTab();
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
        this.tabsEl.insertBefore(tabEl, this.tabAddBtn);

        const pane = new Pane({
            wasm: this.wasm,
            wsUrl: this.wsUrl,
            paneEl,
            tabEl,
            windowEl: this.el,
        });
        this.panes.push(pane);
        this.showPane(pane);
        this.#syncTabClose();
        requestAnimationFrame(() => {
            this.tabsEl.scrollLeft = this.tabsEl.scrollWidth;
            this.layout();
        });
        return pane;
    }

    /** Insert an existing pane (e.g. dragged from another window). */
    insertPane(pane, index = this.panes.length) {
        const at = Math.max(0, Math.min(index, this.panes.length));
        pane.setWindow(this.el);
        this.panes.splice(at, 0, pane);
        this.panesEl.appendChild(pane.el);
        const before = this.panes[at + 1]?.tabEl || this.tabAddBtn;
        this.tabsEl.insertBefore(pane.tabEl, before);
        this.showPane(pane);
        this.#syncTabClose();
        requestAnimationFrame(() => {
            pane.tabEl.scrollIntoView({ inline: "nearest", block: "nearest" });
            this.layout();
        });
    }

    /** Remove pane from this window without disposing the session. */
    releasePane(pane) {
        const index = this.panes.indexOf(pane);
        if (index < 0) return -1;
        this.panes.splice(index, 1);
        if (this.activePane === pane) this.activePane = null;
        pane.el.remove();
        pane.tabEl.remove();
        if (this.panes.length) {
            this.showPane(this.panes[Math.min(index, this.panes.length - 1)]);
        }
        this.#syncTabClose();
        return index;
    }

    reorderPane(pane, index) {
        const from = this.panes.indexOf(pane);
        if (from < 0) return;
        let to = Math.max(0, Math.min(index, this.panes.length));
        if (from === to || from + 1 === to) return;
        this.panes.splice(from, 1);
        if (to > from) to -= 1;
        this.panes.splice(to, 0, pane);
        const before = this.panes[to + 1]?.tabEl || this.tabAddBtn;
        this.tabsEl.insertBefore(pane.tabEl, before);
        this.#syncTabClose();
    }

    showPane(pane) {
        this.activePane = pane;
        for (const p of this.panes) p.setActive(p === pane, this.desktop.focused === this);
        requestAnimationFrame(() => {
            pane.tabEl.scrollIntoView({ inline: "nearest", block: "nearest" });
        });
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

    closeIfEmpty() {
        if (this.panes.length === 0) this.close();
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
        this.maxMenu.hidden = true;
    }

    #applySnapAction(kind) {
        if (kind === "max") this.toggleMaximize();
        else this.snap(kind);
    }

    #paneFromTab(tabEl) {
        return this.panes.find((pane) => pane.tabEl === tabEl) || null;
    }

    #bindChrome() {
        this.el.addEventListener("mousedown", () => this.focus());

        this.titlebar.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            if (event.target.closest(".tab, .tl, .tab-add, .plus, .menu")) return;
            this.desktop.beginDrag(this, event);
        });
        this.titlebar.addEventListener("dblclick", (event) => {
            if (event.target.closest(".tab, .tl, .tab-add, .plus, .menu")) return;
            this.toggleMaximize();
        });

        this.tabsEl.addEventListener("wheel", (event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            if (this.tabsEl.scrollWidth <= this.tabsEl.clientWidth) return;
            event.preventDefault();
            this.tabsEl.scrollLeft += event.deltaY;
        }, { passive: false });

        this.tabsEl.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            const tab = event.target.closest(".tab");
            if (tab && this.tabsEl.contains(tab)) {
                event.stopPropagation();
                this.focus();
                const pane = this.#paneFromTab(tab);
                if (!pane) return;
                if (event.target.closest(".tab-close")) {
                    event.preventDefault();
                    this.closeTab(pane);
                    return;
                }
                this.showPane(pane);
                this.desktop.beginTabDrag(this, pane, event);
                return;
            }
            if (event.target.closest(".tab-add")) return;
            this.desktop.beginDrag(this, event);
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
            this.maxMenu.hidden = !this.maxMenu.hidden;
        });
        this.maxMenu.addEventListener("click", (event) => {
            const kind = event.target.closest("button")?.dataset.snap;
            if (!kind) return;
            this.hideMenus();
            this.#applySnapAction(kind);
        });

        this.tabAddBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.hideMenus();
            this.addTab();
        });

        this.plusBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.hideMenus();
            this.desktop.createWindow();
        });

        this.grip.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            this.desktop.beginResize(this, event);
        });
    }
}

const GAP_MAX = 8;
