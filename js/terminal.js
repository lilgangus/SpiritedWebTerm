import * as C from "./constants.js";

/** libghostty-vt session: parse VT, format HTML, encode input. */
export class Terminal {
    constructor(wasm, cols, rows) {
        this.wasm = wasm;
        this.cols = cols;
        this.rows = rows;
        this.ptr = 0;
        this.keyEncoder = 0;
        this.mouseEncoder = 0;
        this.mouseEvent = 0;
    }

    create() {
        const out = this.wasm.exports.ghostty_wasm_alloc_opaque();
        const created = this.wasm.exports.ghostty_terminal_new(0, out, this.cols, this.rows);
        this.ptr = this.wasm.u32(out);
        this.wasm.exports.ghostty_wasm_free_opaque(out);
        if (created !== C.SUCCESS) throw new Error(`ghostty_terminal_new failed: ${created}`);
        this.#setUsize(C.OPT_SCROLLBACK_BYTES, C.SCROLLBACK_BYTES);
        this.#setUsize(C.OPT_SCROLLBACK_LINES, C.SCROLLBACK_LINES);
        this.#applyTheme();
        this.#createEncoders();
    }

    #setUsize(opt, value) {
        const ptr = this.wasm.exports.ghostty_wasm_alloc_usize();
        this.wasm.setU32(ptr, value);
        this.wasm.exports.ghostty_terminal_set(this.ptr, opt, ptr);
        this.wasm.exports.ghostty_wasm_free_usize(ptr);
    }

    #allocRgb(r, g, b) {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyColorRgb");
        this.wasm.setField(view, "GhosttyColorRgb", "r", r);
        this.wasm.setField(view, "GhosttyColorRgb", "g", g);
        this.wasm.setField(view, "GhosttyColorRgb", "b", b);
        return { ptr, size };
    }

    #applyTheme() {
        const fg = this.#allocRgb(0xff, 0xff, 0xff);
        const bg = this.#allocRgb(0x28, 0x2c, 0x34);
        const cursor = this.#allocRgb(0xff, 0xff, 0xff);
        this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_COLOR_FG, fg.ptr);
        this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_COLOR_BG, bg.ptr);
        this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_COLOR_CURSOR, cursor.ptr);
        this.wasm.free(fg.ptr, fg.size);
        this.wasm.free(bg.ptr, bg.size);
        this.wasm.free(cursor.ptr, cursor.size);

        const palSize = this.wasm.layout.GhosttyColorRgb.size * 256;
        const palPtr = this.wasm.alloc(palSize);
        this.wasm.exports.ghostty_color_palette_default(palPtr);
        this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_COLOR_PALETTE, palPtr);
        this.wasm.free(palPtr, palSize);

        const stylePtr = this.wasm.alloc(4);
        this.wasm.setU32(stylePtr, C.CURSOR_BLOCK);
        this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_CURSOR_STYLE, stylePtr);
        this.wasm.free(stylePtr, 4);
    }

    #createEncoders() {
        const key = this.wasm.newHandle("ghostty_key_encoder_new");
        if (key.result !== C.SUCCESS) throw new Error(`ghostty_key_encoder_new failed: ${key.result}`);
        this.keyEncoder = key.ptr;
        this.syncEncoders();

        const mouse = this.wasm.newHandle("ghostty_mouse_encoder_new");
        if (mouse.result !== C.SUCCESS) return;
        this.mouseEncoder = mouse.ptr;
        const event = this.wasm.newHandle("ghostty_mouse_event_new");
        if (event.result === C.SUCCESS) this.mouseEvent = event.ptr;
        this.syncEncoders();
    }

    reset() {
        if (!this.ptr || !this.wasm.exports.ghostty_terminal_reset) return;
        this.wasm.exports.ghostty_terminal_reset(this.ptr);
        this.#applyTheme();
        this.syncEncoders();
    }

    syncEncoders() {
        if (this.keyEncoder) {
            this.wasm.exports.ghostty_key_encoder_setopt_from_terminal(this.keyEncoder, this.ptr);
        }
        if (this.mouseEncoder) {
            this.wasm.exports.ghostty_mouse_encoder_setopt_from_terminal(this.mouseEncoder, this.ptr);
        }
    }

    setMouseSize(cols, rows, cellW, cellH) {
        if (!this.mouseEncoder || !this.wasm.layout.GhosttyMouseEncoderSize) return;
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyMouseEncoderSize");
        this.wasm.setField(view, "GhosttyMouseEncoderSize", "size", size);
        const fields = this.wasm.layout.GhosttyMouseEncoderSize.fields;
        if (fields.screen_width) {
            this.wasm.setField(view, "GhosttyMouseEncoderSize", "screen_width", Math.round(cols * cellW));
            this.wasm.setField(view, "GhosttyMouseEncoderSize", "screen_height", Math.round(rows * cellH));
        }
        if (fields.cell_width) {
            this.wasm.setField(view, "GhosttyMouseEncoderSize", "cell_width", Math.round(cellW));
            this.wasm.setField(view, "GhosttyMouseEncoderSize", "cell_height", Math.round(cellH));
        }
        this.wasm.exports.ghostty_mouse_encoder_setopt(this.mouseEncoder, 2, ptr);
        this.wasm.free(ptr, size);
    }

    async installEffects({ onWritePty, onBell, onTitle }) {
        try {
            const writeIdx = await this.wasm.installCallback((_t, _ud, dataPtr, len) => {
                if (len) onWritePty(this.wasm.bytes(dataPtr, len).slice());
            }, 4);
            if (writeIdx) this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_WRITE_PTY, writeIdx);
            const bellIdx = await this.wasm.installCallback(() => onBell(), 2);
            if (bellIdx) this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_BELL, bellIdx);
            const titleIdx = await this.wasm.installCallback(() => onTitle(), 2);
            if (titleIdx) this.wasm.exports.ghostty_terminal_set(this.ptr, C.OPT_TITLE_CHANGED, titleIdx);
        } catch (err) {
            console.warn("WASM callbacks unavailable.", err);
        }
    }

    write(bytes, followLive = null) {
        if (!bytes || !bytes.length) return;
        const follow = followLive ?? this.viewportActive();
        const ptr = this.wasm.alloc(bytes.length);
        this.wasm.bytes(ptr, bytes.length).set(bytes);
        this.wasm.exports.ghostty_terminal_vt_write(this.ptr, ptr, bytes.length);
        this.wasm.free(ptr, bytes.length);
        if (follow) this.scroll(C.SCROLL_BOTTOM);
        this.syncEncoders();
    }

    resize(cols, rows, cellW, cellH) {
        this.cols = cols;
        this.rows = rows;
        if (this.wasm.exports.ghostty_terminal_resize) {
            this.wasm.exports.ghostty_terminal_resize(
                this.ptr, cols, rows, Math.round(cellW), Math.round(cellH)
            );
        }
        this.setMouseSize(cols, rows, cellW, cellH);
    }

    viewportActive() {
        const ptr = this.wasm.exports.ghostty_wasm_alloc_u8();
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_VIEWPORT_ACTIVE, ptr);
            if (result !== C.SUCCESS) return true;
            return new DataView(this.wasm.buffer).getUint8(ptr) !== 0;
        } finally {
            this.wasm.exports.ghostty_wasm_free_u8(ptr);
        }
    }

    scroll(tag, value = 0) {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyTerminalScrollViewport");
        view.setUint32(0, tag, true);
        if (tag === C.SCROLL_DELTA) view.setInt32(8, value, true);
        else if (tag === C.SCROLL_ROW) view.setUint32(8, value, true);
        this.wasm.exports.ghostty_terminal_scroll_viewport(this.ptr, ptr);
        this.wasm.free(ptr, size);
    }

    scrollbar() {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyTerminalScrollbar");
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_SCROLLBAR, ptr);
            if (result !== C.SUCCESS) return { total: this.rows, offset: 0, len: this.rows };
            return {
                total: Number(view.getBigUint64(0, true)),
                offset: Number(view.getBigUint64(8, true)),
                len: Number(view.getBigUint64(16, true)),
            };
        } finally {
            this.wasm.free(ptr, size);
        }
    }

    boolData(id) {
        const ptr = this.wasm.exports.ghostty_wasm_alloc_u8();
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, id, ptr);
            if (result !== C.SUCCESS) return false;
            return new DataView(this.wasm.buffer).getUint8(ptr) !== 0;
        } finally {
            this.wasm.exports.ghostty_wasm_free_u8(ptr);
        }
    }

    usizeData(id) {
        const ptr = this.wasm.exports.ghostty_wasm_alloc_usize();
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, id, ptr);
            if (result !== C.SUCCESS) return 0;
            return this.wasm.u32(ptr);
        } finally {
            this.wasm.exports.ghostty_wasm_free_usize(ptr);
        }
    }

    /** COLS/ROWS/CURSOR_* are CellCountInt (u16) in libghostty-vt. */
    cellCountData(id) {
        const ptr = this.wasm.exports.ghostty_wasm_alloc_u16_array(1);
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, id, ptr);
            if (result !== C.SUCCESS) return 0;
            return new DataView(this.wasm.buffer).getUint16(ptr, true);
        } finally {
            this.wasm.exports.ghostty_wasm_free_u16_array(ptr, 1);
        }
    }

    mode(mode) {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyTerminalModeConfig");
        this.wasm.setField(view, "GhosttyTerminalModeConfig", "mode", mode);
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_MODE, ptr);
            if (result !== C.SUCCESS) return false;
            return view.getUint8(this.wasm.field("GhosttyTerminalModeConfig", "value").offset) !== 0;
        } finally {
            this.wasm.free(ptr, size);
        }
    }

    rgb(id) {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyColorRgb");
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, id, ptr);
            if (result !== C.SUCCESS) return null;
            return {
                r: view.getUint8(this.wasm.field("GhosttyColorRgb", "r").offset),
                g: view.getUint8(this.wasm.field("GhosttyColorRgb", "g").offset),
                b: view.getUint8(this.wasm.field("GhosttyColorRgb", "b").offset),
            };
        } finally {
            this.wasm.free(ptr, size);
        }
    }

    title() {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyString");
        try {
            const result = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_TITLE, ptr);
            if (result !== C.SUCCESS) return "Ghostty";
            const strPtr = view.getUint32(this.wasm.field("GhosttyString", "ptr").offset, true);
            const strLen = view.getUint32(this.wasm.field("GhosttyString", "len").offset, true);
            if (!strLen) return "Ghostty";
            return new TextDecoder().decode(this.wasm.bytes(strPtr, strLen));
        } finally {
            this.wasm.free(ptr, size);
        }
    }

    cursor() {
        if (!this.viewportActive()) return { x: 0, y: 0, visible: false };
        const xPtr = this.wasm.exports.ghostty_wasm_alloc_u16_array(1);
        const yPtr = this.wasm.exports.ghostty_wasm_alloc_u16_array(1);
        const visPtr = this.wasm.exports.ghostty_wasm_alloc_u8();
        try {
            const rx = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_CURSOR_X, xPtr);
            const ry = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_CURSOR_Y, yPtr);
            const rv = this.wasm.exports.ghostty_terminal_get(this.ptr, C.DATA_CURSOR_VISIBLE, visPtr);
            if (rx !== C.SUCCESS || ry !== C.SUCCESS || rv !== C.SUCCESS) {
                return { x: 0, y: 0, visible: false };
            }
            const view = new DataView(this.wasm.buffer);
            return {
                x: Math.max(0, Math.min(this.cols - 1, view.getUint16(xPtr, true))),
                y: Math.max(0, Math.min(this.rows - 1, view.getUint16(yPtr, true))),
                visible: view.getUint8(visPtr) !== 0,
            };
        } finally {
            this.wasm.exports.ghostty_wasm_free_u16_array(xPtr, 1);
            this.wasm.exports.ghostty_wasm_free_u16_array(yPtr, 1);
            this.wasm.exports.ghostty_wasm_free_u8(visPtr);
        }
    }

    formatHtml() {
        const selPtr = this.#formatSelection();
        const { ptr: optsPtr, size: optsSize, view } = this.wasm.allocStruct("GhosttyFormatterTerminalOptions");
        this.wasm.setField(view, "GhosttyFormatterTerminalOptions", "size", optsSize);
        this.wasm.setField(view, "GhosttyFormatterTerminalOptions", "emit", C.FORMAT_HTML);
        this.wasm.setField(view, "GhosttyFormatterTerminalOptions", "unwrap", 0);
        this.wasm.setField(view, "GhosttyFormatterTerminalOptions", "trim", 0);

        const extraOffset = this.wasm.field("GhosttyFormatterTerminalOptions", "extra").offset;
        view.setUint32(
            extraOffset + this.wasm.field("GhosttyFormatterTerminalExtra", "size").offset,
            this.wasm.layout.GhosttyFormatterTerminalExtra.size,
            true
        );
        view.setUint8(
            extraOffset + this.wasm.field("GhosttyFormatterTerminalExtra", "palette").offset,
            1
        );
        const screenOffset = this.wasm.field("GhosttyFormatterTerminalExtra", "screen").offset;
        view.setUint32(
            extraOffset + screenOffset + this.wasm.field("GhosttyFormatterScreenExtra", "size").offset,
            this.wasm.layout.GhosttyFormatterScreenExtra.size,
            true
        );
        view.setUint32(
            this.wasm.field("GhosttyFormatterTerminalOptions", "selection").offset,
            selPtr,
            true
        );

        const fmtOut = this.wasm.exports.ghostty_wasm_alloc_opaque();
        const fmtResult = this.wasm.exports.ghostty_formatter_terminal_new(0, fmtOut, this.ptr, optsPtr);
        this.wasm.free(optsPtr, optsSize);
        if (selPtr) this.wasm.free(selPtr, this.wasm.layout.GhosttySelection.size);
        if (fmtResult !== C.SUCCESS) {
            this.wasm.exports.ghostty_wasm_free_opaque(fmtOut);
            throw new Error(`ghostty_formatter_terminal_new failed: ${fmtResult}`);
        }
        const fmtPtr = this.wasm.u32(fmtOut);
        this.wasm.exports.ghostty_wasm_free_opaque(fmtOut);

        const outPtrPtr = this.wasm.exports.ghostty_wasm_alloc_opaque();
        const outLenPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
        const formatResult = this.wasm.exports.ghostty_formatter_format_alloc(fmtPtr, 0, outPtrPtr, outLenPtr);
        if (formatResult !== C.SUCCESS) {
            this.wasm.exports.ghostty_formatter_free(fmtPtr);
            this.wasm.exports.ghostty_wasm_free_opaque(outPtrPtr);
            this.wasm.exports.ghostty_wasm_free_usize(outLenPtr);
            throw new Error(`ghostty_formatter_format_alloc failed: ${formatResult}`);
        }
        const outPtr = this.wasm.u32(outPtrPtr);
        const outLen = this.wasm.u32(outLenPtr);
        const html = new TextDecoder().decode(this.wasm.bytes(outPtr, outLen));
        this.wasm.exports.ghostty_free(0, outPtr, outLen);
        this.wasm.exports.ghostty_wasm_free_opaque(outPtrPtr);
        this.wasm.exports.ghostty_wasm_free_usize(outLenPtr);
        this.wasm.exports.ghostty_formatter_free(fmtPtr);
        return html;
    }

    #allocPoint(tag, x, y) {
        const { ptr, size, view } = this.wasm.allocStruct("GhosttyPoint");
        this.wasm.setField(view, "GhosttyPoint", "tag", tag);
        const valueOff = this.wasm.field("GhosttyPoint", "value").offset;
        const xOff = this.wasm.field("GhosttyPointCoordinate", "x").offset;
        const yOff = this.wasm.field("GhosttyPointCoordinate", "y").offset;
        view.setUint16(valueOff + xOff, x, true);
        view.setUint32(valueOff + yOff, y, true);
        return { ptr, size };
    }

    #gridRef(tag, x, y) {
        const point = this.#allocPoint(tag, x, y);
        const { ptr, size } = this.wasm.allocStruct("GhosttyGridRef");
        this.wasm.setU32(ptr, size);
        const result = this.wasm.exports.ghostty_terminal_grid_ref(this.ptr, point.ptr, ptr);
        this.wasm.free(point.ptr, point.size);
        if (result !== C.SUCCESS) {
            this.wasm.free(ptr, size);
            throw new Error(`ghostty_terminal_grid_ref failed: ${result}`);
        }
        return { ptr, size };
    }

    #formatSelection() {
        try {
            return this.#areaSelection(C.POINT_VIEWPORT);
        } catch (err) {
            console.warn("viewport selection failed; using active area", err);
            return this.#areaSelection(C.POINT_ACTIVE);
        }
    }

    #areaSelection(tag) {
        const cols = Math.max(1, this.cellCountData(C.DATA_COLS) || this.cols);
        const rows = Math.max(1, this.cellCountData(C.DATA_ROWS) || this.rows);
        const start = this.#gridRef(tag, 0, 0);
        const end = this.#gridRef(tag, cols - 1, rows - 1);
        const { ptr, size, view } = this.wasm.allocStruct("GhosttySelection");
        this.wasm.setU32(ptr, size);
        const startOff = this.wasm.field("GhosttySelection", "start").offset;
        const endOff = this.wasm.field("GhosttySelection", "end").offset;
        this.wasm.bytes(ptr + startOff, start.size).set(this.wasm.bytes(start.ptr, start.size));
        this.wasm.bytes(ptr + endOff, end.size).set(this.wasm.bytes(end.ptr, end.size));
        this.wasm.setField(view, "GhosttySelection", "rectangle", 1);
        this.wasm.free(start.ptr, start.size);
        this.wasm.free(end.ptr, end.size);
        return ptr;
    }

    encodeKey(event, action, keyCode) {
        const { result, ptr: eventPtr } = this.wasm.newHandle("ghostty_key_event_new");
        if (result !== C.SUCCESS) return null;
        let utf8Ptr = 0;
        let utf8Len = 0;
        try {
            this.wasm.exports.ghostty_key_event_set_action(eventPtr, action);
            this.wasm.exports.ghostty_key_event_set_key(eventPtr, keyCode || 0);
            let mods = 0;
            if (event.shiftKey) { mods |= 0x01; if (event.code === "ShiftRight") mods |= 0x40; }
            if (event.ctrlKey) { mods |= 0x02; if (event.code === "ControlRight") mods |= 0x80; }
            if (event.altKey) { mods |= 0x04; if (event.code === "AltRight") mods |= 0x100; }
            if (event.metaKey) { mods |= 0x08; if (event.code === "MetaRight") mods |= 0x200; }
            this.wasm.exports.ghostty_key_event_set_mods(eventPtr, mods);
            const keyCp = event.key.length === 1 ? event.key.codePointAt(0) : 0;
            if (keyCp >= 0x20 && keyCp !== 0x7f && action !== C.KEY_RELEASE) {
                const utf8 = new TextEncoder().encode(event.key);
                utf8Len = utf8.length;
                utf8Ptr = this.wasm.alloc(utf8Len);
                this.wasm.bytes(utf8Ptr, utf8Len).set(utf8);
                this.wasm.exports.ghostty_key_event_set_utf8(eventPtr, utf8Ptr, utf8Len);
            }
            const unshifted = unshiftedCodepoint(event);
            if (unshifted) {
                this.wasm.exports.ghostty_key_event_set_unshifted_codepoint(eventPtr, unshifted);
            }
            const needPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
            this.wasm.exports.ghostty_key_encoder_encode(this.keyEncoder, eventPtr, 0, 0, needPtr);
            const need = this.wasm.u32(needPtr);
            const bufPtr = this.wasm.alloc(need || 1);
            const writtenPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
            const encoded = this.wasm.exports.ghostty_key_encoder_encode(
                this.keyEncoder, eventPtr, bufPtr, need, writtenPtr
            );
            let out = null;
            if (encoded === C.SUCCESS) {
                out = this.wasm.bytes(bufPtr, this.wasm.u32(writtenPtr)).slice();
            }
            this.wasm.exports.ghostty_wasm_free_usize(needPtr);
            this.wasm.exports.ghostty_wasm_free_usize(writtenPtr);
            this.wasm.free(bufPtr, need || 1);
            return out;
        } finally {
            if (utf8Ptr) this.wasm.free(utf8Ptr, utf8Len);
            this.wasm.exports.ghostty_key_event_free(eventPtr);
        }
    }

    encodePaste(text) {
        const src = new TextEncoder().encode(text);
        const dataPtr = this.wasm.alloc(src.length || 1);
        this.wasm.bytes(dataPtr, src.length || 1).set(src);
        const safe = this.wasm.exports.ghostty_paste_is_safe(dataPtr, src.length);
        if (!safe && !window.confirm(
            "This paste contains newlines or a bracketed-paste terminator.\nPaste anyway?"
        )) {
            this.wasm.free(dataPtr, src.length || 1);
            return null;
        }
        const bracketed = this.mode(C.MODE_BRACKETED_PASTE) ? 1 : 0;
        const writtenPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
        this.wasm.exports.ghostty_paste_encode(dataPtr, src.length, bracketed, 0, 0, writtenPtr);
        const needed = Math.max(this.wasm.u32(writtenPtr), src.length + 16);
        const outPtr = this.wasm.alloc(needed);
        const result = this.wasm.exports.ghostty_paste_encode(
            dataPtr, src.length, bracketed, outPtr, needed, writtenPtr
        );
        const out = result === C.SUCCESS
            ? this.wasm.bytes(outPtr, this.wasm.u32(writtenPtr)).slice()
            : null;
        this.wasm.free(outPtr, needed);
        this.wasm.free(dataPtr, src.length || 1);
        this.wasm.exports.ghostty_wasm_free_usize(writtenPtr);
        return out;
    }

    encodeFocus(gained) {
        if (!this.mode(C.MODE_FOCUS_EVENT)) return null;
        const writtenPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
        const bufPtr = this.wasm.alloc(8);
        const result = this.wasm.exports.ghostty_focus_encode(
            gained ? C.FOCUS_IN : C.FOCUS_OUT, bufPtr, 8, writtenPtr
        );
        const out = result === C.SUCCESS
            ? this.wasm.bytes(bufPtr, this.wasm.u32(writtenPtr)).slice()
            : null;
        this.wasm.free(bufPtr, 8);
        this.wasm.exports.ghostty_wasm_free_usize(writtenPtr);
        return out;
    }

    encodeMouse(action, button, mods, x, y) {
        if (!this.mouseEncoder || !this.mouseEvent) return null;
        this.wasm.exports.ghostty_mouse_event_set_action(this.mouseEvent, action);
        if (button) this.wasm.exports.ghostty_mouse_event_set_button(this.mouseEvent, button);
        else if (this.wasm.exports.ghostty_mouse_event_clear_button) {
            this.wasm.exports.ghostty_mouse_event_clear_button(this.mouseEvent);
        }
        this.wasm.exports.ghostty_mouse_event_set_mods(this.mouseEvent, mods);
        try {
            this.wasm.exports.ghostty_mouse_event_set_position(this.mouseEvent, x, y);
        } catch {
            return null;
        }
        const writtenPtr = this.wasm.exports.ghostty_wasm_alloc_usize();
        const bufPtr = this.wasm.alloc(64);
        const result = this.wasm.exports.ghostty_mouse_encoder_encode(
            this.mouseEncoder, this.mouseEvent, bufPtr, 64, writtenPtr
        );
        const out = result === C.SUCCESS
            ? this.wasm.bytes(bufPtr, this.wasm.u32(writtenPtr)).slice()
            : null;
        this.wasm.free(bufPtr, 64);
        this.wasm.exports.ghostty_wasm_free_usize(writtenPtr);
        return out && out.length ? out : null;
    }
}

function unshiftedCodepoint(event) {
    const code = event.code;
    if (code.startsWith("Key")) return code.slice(3).toLowerCase().codePointAt(0);
    if (code.startsWith("Digit")) return code.slice(5).codePointAt(0);
    if (code === "Space") return 32;
    const symbols = {
        Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
        Backslash: "\\", Semicolon: ";", Quote: "'",
        Backquote: "`", Comma: ",", Period: ".", Slash: "/",
    };
    if (symbols[code]) return symbols[code].codePointAt(0);
    if (event.key.length > 0) return event.key.codePointAt(0) || 0;
    return 0;
}

