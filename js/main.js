import { Wasm } from "./wasm.js";
import { Desktop } from "./desktop.js";

async function main() {
    const wasm = await Wasm.load("/ghostty-vt.wasm");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const desktop = new Desktop({
        el: document.getElementById("desktop"),
        wasm,
        wsUrl: `${proto}//${location.host}/ws`,
        windowTemplate: document.getElementById("window-template"),
        tabTemplate: document.getElementById("tab-template"),
        paneTemplate: document.getElementById("pane-template"),
    });
    desktop.createWindow();
}

main().catch((err) => {
    console.error(err);
    const el = document.getElementById("boot-error");
    el.hidden = false;
    el.textContent = err.stack || String(err);
});
