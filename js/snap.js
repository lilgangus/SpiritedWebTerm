const SNAP = {
    left: { x: 0, y: 0, w: 0.5, h: 1 },
    right: { x: 0.5, y: 0, w: 0.5, h: 1 },
    "top-left": { x: 0, y: 0, w: 0.5, h: 0.5 },
    "top-right": { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    "bottom-left": { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    "bottom-right": { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
};

const GAP = 8;

export function snapRect(kind, deskW, deskH) {
    const spec = SNAP[kind];
    if (!spec) return null;
    const innerW = deskW - GAP * 2;
    const innerH = deskH - GAP * 2;
    const w = Math.floor(innerW * spec.w) - (spec.w < 1 ? GAP / 2 : 0);
    const h = Math.floor(innerH * spec.h) - (spec.h < 1 ? GAP / 2 : 0);
    const x = GAP + Math.floor(innerW * spec.x) + (spec.x > 0 ? GAP / 2 : 0);
    const y = GAP + Math.floor(innerH * spec.y) + (spec.y > 0 ? GAP / 2 : 0);
    return { x, y, w, h };
}

/** Which snap zone the pointer is in, or null. */
export function hitSnap(mx, my, deskW, deskH) {
    const corner = 72;
    const edge = 28;
    if (mx <= corner && my <= corner) return "top-left";
    if (mx >= deskW - corner && my <= corner) return "top-right";
    if (mx <= corner && my >= deskH - corner) return "bottom-left";
    if (mx >= deskW - corner && my >= deskH - corner) return "bottom-right";
    if (mx <= edge) return "left";
    if (mx >= deskW - edge) return "right";
    return null;
}
