/** WebSocket PTY client. Binary frames are PTY bytes; text frames are control. */
export class Pty {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this._onOpen = [];
        this._onClose = [];
        this._onData = [];
    }

    get open() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    get connecting() {
        return this.ws !== null && this.ws.readyState === WebSocket.CONNECTING;
    }

    onOpen(fn) {
        this._onOpen.push(fn);
    }

    onClose(fn) {
        this._onClose.push(fn);
    }

    onData(fn) {
        this._onData.push(fn);
    }

    connect() {
        if (this.open || this.connecting) return;
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.binaryType = "arraybuffer";
        ws.addEventListener("open", () => {
            if (this.ws !== ws) return;
            for (const fn of this._onOpen) fn();
        });
        ws.addEventListener("close", () => {
            if (this.ws !== ws) return;
            this.ws = null;
            for (const fn of this._onClose) fn();
        });
        ws.addEventListener("message", (ev) => {
            if (this.ws !== ws) return;
            const bytes = ev.data instanceof ArrayBuffer
                ? new Uint8Array(ev.data)
                : new TextEncoder().encode(String(ev.data));
            for (const fn of this._onData) fn(bytes);
        });
    }

    send(bytes) {
        if (!bytes || !bytes.length || !this.open) return;
        this.ws.send(bytes);
    }

    resize(cols, rows) {
        if (!this.open) return;
        this.ws.send(`resize ${cols} ${rows}`);
    }

    close() {
        if (!this.ws) return;
        this.ws.close();
    }
}
