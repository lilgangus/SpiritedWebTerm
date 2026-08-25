import * as C from "./constants.js";
import { Terminal } from "./terminal.js";
import { Pty } from "./pty.js";
import { Chrome } from "./chrome.js";
import { bindInput } from "./input.js";

/** One tab: VT terminal + PTY + pane chrome. */
export class Pane {
    constructor({ wasm, wsUrl, paneEl, tabEl, windowEl }) {
        this.el = paneEl;
        this.tabEl = tabEl;
        this.hadSession = false;
        this.dirty = false;

        this.term = new Terminal(wasm, 80, 24);
        this.term.create();
        this.pty = new Pty(wsUrl);
        this.ui = new Chrome({
            term: this.term,
            pty: this.pty,
            pane: paneEl,
            windowEl,
            tabEl,
        });

        this.pty.onOpen(() => {
            this.hadSession = true;
            this.term.reset();
            this.pty.resize(this.ui.cols, this.ui.rows);
            this.ui.setDisconnected(false);
            this.ui.render();
            this.ui.screen.focus();
        });
        this.pty.onClose(() => {
            this.ui.setDisconnected(true, this.hadSession);
            this.ui.render();
        });
        this.pty.onData((bytes) => {
            if (this.ui.followLive) this.term.scroll(C.SCROLL_BOTTOM);
            this.term.write(bytes, this.ui.followLive);
            if (this.ui.active) this.ui.render();
            else this.dirty = true;
        });

        this.ui.openButton.addEventListener("click", () => this.#connect());
        this.ui.viewButton.addEventListener("click", () => this.ui.viewLogs());
        this.ui.screen.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.ui.readonly) {
                event.preventDefault();
                this.ui.exitViewLogs();
            }
        });

        this.term.installEffects({
            onWritePty: (bytes) => this.pty.send(bytes),
            onBell: () => {
                if (this.ui.active) this.ui.flashBell();
            },
            onTitle: () => {
                if (this.pty.open) this.ui.updateTitle();
            },
        }).catch((err) => console.warn("WASM callbacks unavailable.", err));

        this.ui.bindScrollbar();
        bindInput({
            term: this.term,
            pty: this.pty,
            screen: this.ui.screen,
            wrap: this.ui.wrap,
            ui: this.ui,
        });
        this.ui.setDisconnected(true, false);
        this.ui.render();
    }

    #connect() {
        if (this.pty.open || this.pty.connecting) return;
        this.ui.prepareConnect();
        this.pty.connect();
    }

    setWindow(windowEl) {
        this.ui.setWindow(windowEl);
    }

    setActive(active, windowFocused) {
        this.ui.active = active;
        this.ui.windowFocused = windowFocused;
        this.el.classList.toggle("active", active);
        this.tabEl.classList.toggle("active", active);
        if (active) {
            this.ui.measureCells();
            this.ui.resizeToFit();
            if (this.dirty) {
                this.dirty = false;
                this.ui.render();
            }
            if (this.pty.open) {
                this.ui.updateTitle();
                this.ui.screen.focus();
            } else {
                this.ui.setDisconnected(true, this.hadSession);
            }
        }
    }

    layout() {
        this.ui.measureCells();
        this.ui.resizeToFit();
    }

    dispose() {
        this.pty.close();
        this.el.remove();
        this.tabEl.remove();
    }
}
