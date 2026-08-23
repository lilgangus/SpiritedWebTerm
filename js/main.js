import { Wasm } from "./wasm.js";
import { Terminal } from "./terminal.js";
import { Pty } from "./pty.js";
import { Chrome } from "./chrome.js";
import { bindInput } from "./input.js";

async function main() {
    const wasm = await Wasm.load("/ghostty-vt.wasm");
    const term = new Terminal(wasm, 80, 24);
    term.create();

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const pty = new Pty(`${proto}//${location.host}/ws`);
    const ui = new Chrome({ term, pty });
    let hadSession = false;

    await term.installEffects({
        onWritePty: (bytes) => pty.send(bytes),
        onBell: () => ui.flashBell(),
        onTitle: () => {
            if (pty.open) ui.updateTitle();
        },
    });

    ui.bindScrollbar();
    ui.measureCells();
    ui.resizeToFit();
    ui.setDisconnected(true, false);
    ui.render();

    pty.onOpen(() => {
        hadSession = true;
        term.reset();
        pty.resize(ui.cols, ui.rows);
        ui.setDisconnected(false);
        ui.render();
        ui.screen.focus();
    });
    pty.onClose(() => {
        ui.setDisconnected(true, hadSession);
        ui.render();
    });
    pty.onData((bytes) => {
        term.write(bytes);
        ui.render();
    });

    ui.openButton.addEventListener("click", () => {
        if (pty.open || pty.connecting) return;
        ui.openButton.disabled = true;
        pty.connect();
    });

    bindInput({
        term,
        pty,
        screen: ui.screen,
        wrap: ui.wrap,
        ui,
    });

    new ResizeObserver(() => {
        ui.measureCells();
        ui.resizeToFit();
    }).observe(ui.wrap);
}

main().catch((err) => {
    console.error(err);
    document.getElementById("window").classList.add("error");
    document.getElementById("boot-error").textContent = err.stack || String(err);
});
