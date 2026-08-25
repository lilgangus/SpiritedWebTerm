/** In-pane find bar: scrollback search with match highlights. */
export class Search {
    constructor({ term, wrap, screen, onChange }) {
        this.term = term;
        this.wrap = wrap;
        this.screen = screen;
        this.onChange = onChange;
        this.open = false;
        this.needle = "";
        this.matches = [];
        this.selected = -1;
        this.refreshTimer = 0;

        this.overlay = wrap.querySelector(".search-overlay");
        this.input = wrap.querySelector(".search-input");
        this.countEl = wrap.querySelector(".search-count");
        this.highlights = wrap.querySelector(".search-highlights");
        this.prevBtn = wrap.querySelector(".search-prev");
        this.nextBtn = wrap.querySelector(".search-next");
        this.closeBtn = wrap.querySelector(".search-close");

        this.input.addEventListener("input", () => {
            this.needle = this.input.value;
            this.runSearch();
        });
        this.input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) this.previous();
                else this.next();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                if (this.needle) {
                    this.input.select();
                    this.screen.focus();
                } else {
                    this.close();
                }
            }
        });
        this.prevBtn.addEventListener("click", () => this.next());
        this.nextBtn.addEventListener("click", () => this.previous());
        this.closeBtn.addEventListener("click", () => this.close());
    }

    isOpen() {
        return this.open;
    }

    openWith(initial = "") {
        this.open = true;
        this.overlay.classList.remove("hidden");
        this.input.value = initial;
        this.needle = initial;
        this.runSearch();
        requestAnimationFrame(() => {
            this.input.focus();
            this.input.select();
        });
    }

    close() {
        this.open = false;
        this.needle = "";
        this.matches = [];
        this.selected = -1;
        this.overlay.classList.add("hidden");
        this.input.value = "";
        this.countEl.textContent = "";
        this.highlights.replaceChildren();
        this.onChange();
        this.screen.focus();
    }

    runSearch({ scroll = true } = {}) {
        if (!this.needle) {
            this.matches = [];
            this.selected = -1;
            this.updateCount();
            this.onChange();
            return;
        }
        const prev = this.selected >= 0 ? this.matches[this.selected] : null;
        this.matches = this.term.searchNeedle(this.needle);
        if (!this.matches.length) {
            this.selected = -1;
        } else if (prev) {
            const idx = this.matches.findIndex((m) => m.y === prev.y && m.x === prev.x);
            this.selected = idx >= 0 ? idx : 0;
        } else {
            this.selected = 0;
        }
        if (scroll && this.selected >= 0) {
            this.term.scrollToScreenRow(this.matches[this.selected].y);
        }
        this.updateCount();
        this.onChange();
    }

    scheduleRefresh() {
        if (!this.open || !this.needle) return;
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = 0;
            this.runSearch({ scroll: false });
        }, 150);
    }

    next() {
        if (!this.matches.length) return;
        this.selected = (this.selected + 1) % this.matches.length;
        this.revealSelected();
    }

    previous() {
        if (!this.matches.length) return;
        this.selected = (this.selected - 1 + this.matches.length) % this.matches.length;
        this.revealSelected();
    }

    revealSelected() {
        const match = this.matches[this.selected];
        if (!match) return;
        this.term.scrollToScreenRow(match.y);
        this.updateCount();
        this.onChange();
    }

    updateCount() {
        if (!this.needle) {
            this.countEl.textContent = "";
            return;
        }
        if (!this.matches.length) {
            this.countEl.textContent = "-/0";
            return;
        }
        this.countEl.textContent = `${this.selected + 1}/${this.matches.length}`;
    }

    updateHighlights(cellW, cellH) {
        this.highlights.replaceChildren();
        if (!this.open || !this.needle || !this.matches.length) return;

        const sb = this.term.scrollbar();
        const frag = document.createDocumentFragment();
        for (let i = 0; i < this.matches.length; i++) {
            const match = this.matches[i];
            const viewRow = match.y - sb.offset;
            if (viewRow < 0 || viewRow >= sb.len) continue;
            const box = document.createElement("div");
            box.className = i === this.selected ? "search-hit selected" : "search-hit";
            box.style.left = `${match.x * cellW}px`;
            box.style.top = `${viewRow * cellH}px`;
            box.style.width = `${Math.max(1, match.len) * cellW}px`;
            box.style.height = `${cellH}px`;
            frag.appendChild(box);
        }
        this.highlights.appendChild(frag);
    }

    handleChord(event) {
        if (isFindChord(event)) {
            event.preventDefault();
            const initial = selectedScreenText(this.screen);
            if (this.open) {
                this.input.focus();
                this.input.select();
            } else {
                this.openWith(initial);
            }
            return true;
        }
        if (!this.open) return false;

        if (event.key.toLowerCase() === "g" && isSuperLike(event)) {
            event.preventDefault();
            if (event.shiftKey) this.previous();
            else this.next();
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            this.close();
            return true;
        }
        return false;
    }
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function isSuperLike(event) {
    return isMac ? (event.metaKey && !event.ctrlKey) : event.ctrlKey;
}

function isFindChord(event) {
    if (event.key.toLowerCase() !== "f") return false;
    return isMac
        ? (event.metaKey && !event.ctrlKey && !event.altKey)
        : (event.ctrlKey && event.shiftKey && !event.altKey);
}

function selectedScreenText(screen) {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return "";
    if (!screen.contains(sel.anchorNode) && !screen.contains(sel.focusNode)) return "";
    return sel.toString().replace(/\n$/, "");
}
