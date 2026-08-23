import * as C from "./constants.js";
import { KEY_CODES } from "./keymap.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function isCopyChord(event) {
    if (event.key.toLowerCase() !== "c") return false;
    return isMac ? (event.metaKey && !event.ctrlKey && !event.altKey)
        : (event.ctrlKey && event.shiftKey);
}

function isPasteChord(event) {
    if (event.key.toLowerCase() !== "v") return false;
    return isMac ? (event.metaKey && !event.ctrlKey && !event.altKey)
        : (event.ctrlKey && event.shiftKey);
}

function isSelectAllChord(event) {
    if (event.key.toLowerCase() !== "a") return false;
    return isMac ? (event.metaKey && !event.ctrlKey && !event.altKey)
        : (event.ctrlKey && event.shiftKey);
}

function isFontChord(event) {
    const superLike = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey;
    if (!superLike || event.altKey) return null;
    if (event.key === "=" || event.key === "+") return "inc";
    if (event.key === "-") return "dec";
    if (event.key === "0") return "reset";
    return null;
}

function selectedText(screen) {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return "";
    if (!screen.contains(sel.anchorNode) && !screen.contains(sel.focusNode)) return "";
    return sel.toString();
}

function mouseButton(event) {
    if (event.button === 0) return C.MOUSE_LEFT;
    if (event.button === 1) return C.MOUSE_MIDDLE;
    if (event.button === 2) return C.MOUSE_RIGHT;
    return 0;
}

function mouseMods(event) {
    let mods = 0;
    if (event.shiftKey) mods |= 0x01;
    if (event.ctrlKey) mods |= 0x02;
    if (event.altKey) mods |= 0x04;
    if (event.metaKey) mods |= 0x08;
    return mods;
}

/**
 * Bind keyboard, clipboard, focus, mouse, and wheel to a terminal + PTY.
 * `ui` must expose followLive, jumpToLive(), render(), onFontChord(), mousePos().
 */
export function bindInput({ term, pty, screen, wrap, ui }) {
    let mouseDown = false;

    function sendMouse(action, button, event) {
        const pos = ui.mousePos(event);
        const bytes = term.encodeMouse(action, button, mouseMods(event), pos.x, pos.y);
        if (bytes) pty.send(bytes);
    }

    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                ui.jumpToLive();
                const bytes = term.encodePaste(text);
                if (bytes) pty.send(bytes);
            }
        } catch { /* clipboard permission denied */ }
    }

    screen.addEventListener("keydown", (event) => {
        if (!pty.open) return;
        if (event.isComposing || event.key === "Process") return;
        if (event.key === "F5" || (event.metaKey && event.key === "r" && !event.ctrlKey)) return;

        const fontChord = isFontChord(event);
        if (fontChord) {
            event.preventDefault();
            ui.onFontChord(fontChord);
            return;
        }
        if (isCopyChord(event)) {
            if (selectedText(screen)) {
                event.preventDefault();
                navigator.clipboard.writeText(selectedText(screen)).catch(() => {});
            }
            return;
        }
        if (isPasteChord(event)) {
            event.preventDefault();
            pasteFromClipboard();
            return;
        }
        if (isSelectAllChord(event)) {
            event.preventDefault();
            const range = document.createRange();
            range.selectNodeContents(screen);
            const sel = document.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }

        event.preventDefault();
        ui.jumpToLive();
        const action = event.repeat ? C.KEY_REPEAT : C.KEY_PRESS;
        const bytes = term.encodeKey(event, action, KEY_CODES[event.code] || 0);
        if (bytes) pty.send(bytes);
    });

    screen.addEventListener("keyup", (event) => {
        if (!pty.open || event.isComposing) return;
        if (isCopyChord(event) || isPasteChord(event) || isSelectAllChord(event)) return;
        if (isFontChord(event)) return;
        const bytes = term.encodeKey(event, C.KEY_RELEASE, KEY_CODES[event.code] || 0);
        if (bytes) pty.send(bytes);
    });

    screen.addEventListener("focus", () => {
        const bytes = term.encodeFocus(true);
        if (bytes) pty.send(bytes);
    });
    screen.addEventListener("blur", () => {
        const bytes = term.encodeFocus(false);
        if (bytes) pty.send(bytes);
    });

    wrap.addEventListener("wheel", (event) => {
        event.preventDefault();
        if (term.boolData(C.DATA_MOUSE_TRACKING) && !event.shiftKey) {
            sendMouse(
                C.MOUSE_PRESS,
                event.deltaY < 0 ? C.MOUSE_FOUR : C.MOUSE_FIVE,
                event
            );
            return;
        }
        ui.followLive = false;
        const lines = Math.max(1, Math.round(Math.abs(event.deltaY) / 40));
        term.scroll(C.SCROLL_DELTA, event.deltaY < 0 ? -lines : lines);
        ui.render();
    }, { passive: false });

    wrap.addEventListener("mousedown", (event) => {
        screen.focus();
        if (event.button === 1) {
            event.preventDefault();
            pasteFromClipboard();
            return;
        }
        if (term.boolData(C.DATA_MOUSE_TRACKING) && !event.shiftKey) {
            event.preventDefault();
            mouseDown = true;
            sendMouse(C.MOUSE_PRESS, mouseButton(event), event);
        }
    });

    window.addEventListener("mousemove", (event) => {
        if (mouseDown && term.boolData(C.DATA_MOUSE_TRACKING)) {
            sendMouse(C.MOUSE_MOTION, mouseButton(event), event);
        }
    });
    window.addEventListener("mouseup", (event) => {
        if (!mouseDown) return;
        mouseDown = false;
        sendMouse(C.MOUSE_RELEASE, mouseButton(event), event);
    });

    screen.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = event.clipboardData && event.clipboardData.getData("text/plain");
        if (!text) return;
        ui.jumpToLive();
        const bytes = term.encodePaste(text);
        if (bytes) pty.send(bytes);
    });
    screen.addEventListener("copy", (event) => {
        const text = selectedText(screen);
        if (!text) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", text);
    });
    screen.addEventListener("compositionend", (event) => {
        if (!event.data) return;
        ui.jumpToLive();
        const bytes = term.encodePaste(event.data);
        if (bytes) pty.send(bytes);
    });
}
