#!/usr/bin/env python3
"""Minimal HTTP + WebSocket PTY bridge for the wasm browser terminal example.

Serves static files on PORT (default 8001) and bridges /ws to a real shell
running in a PTY. No third-party dependencies (stdlib only).
"""

from __future__ import annotations

import base64
import hashlib
import os
import pty
import select
import signal
import socket
import struct
import sys
import termios
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

PORT = int(os.environ.get("PORT", "8001"))
COLS = int(os.environ.get("COLS", "80"))
ROWS = int(os.environ.get("ROWS", "24"))
SHELL = os.environ.get("SHELL", "/bin/bash")

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
WASM_PATH = REPO_ROOT / "zig-out" / "bin" / "ghostty-vt.wasm"

WS_MAGIC = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def set_winsize(fd: int, rows: int, cols: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    # TIOCSWINSZ
    fcntl_ioctl = getattr(__import__("fcntl"), "ioctl")
    fcntl_ioctl(fd, getattr(termios, "TIOCSWINSZ", 0x80087467), packed)


def spawn_shell(cols: int, rows: int) -> tuple[int, int]:
    """Fork a login-ish shell in a PTY. Returns (pid, master_fd)."""
    master, slave = pty.openpty()
    set_winsize(slave, rows, cols)
    set_winsize(master, rows, cols)

    pid = os.fork()
    if pid == 0:
        try:
            os.close(master)
            os.setsid()
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
            if slave > 2:
                os.close(slave)

            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            env["COLUMNS"] = str(cols)
            env["LINES"] = str(rows)
            # Minimal interactive shell; -l gives a login shell when possible.
            argv = [SHELL, "-l"] if os.path.basename(SHELL) in ("bash", "zsh") else [SHELL]
            os.execvpe(argv[0], argv, env)
        except Exception as exc:  # pragma: no cover
            sys.stderr.write(f"exec failed: {exc}\n")
            os._exit(127)

    os.close(slave)
    return pid, master


def recv_exact(conn: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed")
        buf.extend(chunk)
    return bytes(buf)


def ws_accept_key(sec_key: str) -> str:
    digest = hashlib.sha1(sec_key.encode("utf-8") + WS_MAGIC).digest()
    return base64.b64encode(digest).decode("ascii")


def ws_send(conn: socket.socket, data: bytes, opcode: int = 0x2) -> None:
    """Send a WebSocket frame (server -> client, unmasked). Default binary."""
    length = len(data)
    header = bytearray([0x80 | (opcode & 0x0F)])
    if length < 126:
        header.append(length)
    elif length < (1 << 16):
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    conn.sendall(header + data)


def ws_recv_frame(conn: socket.socket) -> tuple[int, bytes]:
    """Receive one WebSocket frame. Returns (opcode, payload)."""
    b1, b2 = recv_exact(conn, 2)
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(conn, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(conn, 8))[0]

    mask = recv_exact(conn, 4) if masked else b""
    payload = recv_exact(conn, length) if length else b""
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def bridge_pty(conn: socket.socket, cols: int, rows: int) -> None:
    pid, master = spawn_shell(cols, rows)
    conn.setblocking(False)
    os.set_blocking(master, False)

    try:
        while True:
            r, _, _ = select.select([conn, master], [], [], 30.0)
            if not r:
                # Idle keepalive ping
                try:
                    ws_send(conn, b"", opcode=0x9)
                except OSError:
                    break
                continue

            if master in r:
                try:
                    data = os.read(master, 8192)
                except OSError:
                    data = b""
                if not data:
                    break
                try:
                    ws_send(conn, data, opcode=0x2)
                except OSError:
                    break

            if conn in r:
                try:
                    opcode, payload = ws_recv_frame(conn)
                except (ConnectionError, OSError, struct.error):
                    break

                if opcode == 0x8:  # close
                    break
                if opcode == 0x9:  # ping
                    ws_send(conn, payload, opcode=0xA)
                    continue
                if opcode == 0xA:  # pong
                    continue
                if opcode in (0x1, 0x2) and payload:
                    # Optional text control: "resize COLS ROWS"
                    if opcode == 0x1:
                        try:
                            text = payload.decode("utf-8")
                        except UnicodeDecodeError:
                            text = ""
                        if text.startswith("resize "):
                            parts = text.split()
                            if len(parts) == 3:
                                try:
                                    new_cols = max(1, int(parts[1]))
                                    new_rows = max(1, int(parts[2]))
                                    set_winsize(master, new_rows, new_cols)
                                    # Notify child via SIGWINCH
                                    os.kill(pid, signal.SIGWINCH)
                                except (ValueError, OSError):
                                    pass
                            continue
                    try:
                        os.write(master, payload)
                    except OSError:
                        break
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
        try:
            conn.close()
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/ws":
            self._handle_websocket()
            return

        self._serve_static(path)

    def _handle_websocket(self) -> None:
        key = self.headers.get("Sec-WebSocket-Key")
        upgrade = (self.headers.get("Upgrade") or "").lower()
        if not key or upgrade != "websocket":
            self.send_error(400, "Expected WebSocket upgrade")
            return

        accept = ws_accept_key(key)
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        # Detach the socket from the HTTP handler and bridge to PTY.
        conn = self.connection
        self.close_connection = True
        # Run bridge in this request thread (ThreadingHTTPServer).
        bridge_pty(conn, COLS, ROWS)

    def _serve_static(self, path: str) -> None:
        if path in ("/", "/index.html"):
            file_path = HERE / "index.html"
            content_type = "text/html; charset=utf-8"
        elif path == "/ghostty-vt.wasm":
            file_path = WASM_PATH
            content_type = "application/wasm"
        else:
            self.send_error(404)
            return

        if not file_path.is_file():
            self.send_error(404, f"Missing {file_path.name}. Build wasm first if needed.")
            return

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    if not WASM_PATH.is_file():
        sys.stderr.write(
            f"warning: {WASM_PATH} not found.\n"
            "Build with:\n"
            "  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall\n"
        )

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"Browser terminal: http://127.0.0.1:{PORT}/\n")
    sys.stderr.write(f"WebSocket PTY:    ws://127.0.0.1:{PORT}/ws  ({SHELL}, {COLS}x{ROWS})\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\nshutting down\n")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
