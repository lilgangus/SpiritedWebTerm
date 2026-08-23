/** WebSocket PTY client. Binary frames are PTY bytes; text frames are control. */
export class Pty {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";
    }

    get open() {
        return this.ws.readyState === WebSocket.OPEN;
    }

    onOpen(fn) {
        this.ws.addEventListener("open", fn);
    }

    onClose(fn) {
        this.ws.addEventListener("close", fn);
    }

    onData(fn) {
        this.ws.addEventListener("message", (ev) => {
            const bytes = ev.data instanceof ArrayBuffer
                ? new Uint8Array(ev.data)
                : new TextEncoder().encode(String(ev.data));
            fn(bytes);
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
}
