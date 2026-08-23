/**
 * Thin helpers around ghostty-vt.wasm: load, heap access, sized-struct fields.
 */
export class Wasm {
    constructor(instance, layout) {
        this.instance = instance;
        this.layout = layout;
    }

    static async load(url) {
        const bytes = await fetch(url).then((r) => r.arrayBuffer());
        let instance;
        const result = await WebAssembly.instantiate(bytes, {
            env: {
                log: (ptr, len) => {
                    const heap = new Uint8Array(instance.exports.memory.buffer, ptr, len);
                    console.log("[wasm]", new TextDecoder().decode(heap));
                },
            },
        });
        instance = result.instance;
        const jsonPtr = instance.exports.ghostty_type_json();
        const json = new TextDecoder()
            .decode(new Uint8Array(
                instance.exports.memory.buffer,
                jsonPtr,
                instance.exports.memory.buffer.byteLength - jsonPtr
            ))
            .split("\0")[0];
        return new Wasm(instance, JSON.parse(json));
    }

    get exports() {
        return this.instance.exports;
    }

    get buffer() {
        return this.instance.exports.memory.buffer;
    }

    bytes(ptr, n) {
        return new Uint8Array(this.buffer, ptr, n);
    }

    view(ptr, n) {
        return new DataView(this.buffer, ptr, n);
    }

    u32(ptr) {
        return new DataView(this.buffer).getUint32(ptr, true);
    }

    setU32(ptr, value) {
        new DataView(this.buffer).setUint32(ptr, value, true);
    }

    alloc(n) {
        return this.exports.ghostty_wasm_alloc_u8_array(n);
    }

    free(ptr, n) {
        this.exports.ghostty_wasm_free_u8_array(ptr, n);
    }

    field(structName, fieldName) {
        const structInfo = this.layout[structName];
        if (!structInfo) throw new Error(`unknown struct ${structName}`);
        const field = structInfo.fields[fieldName];
        if (!field) throw new Error(`${structName}.${fieldName} missing`);
        return field;
    }

    setField(view, structName, fieldName, value) {
        const field = this.field(structName, fieldName);
        switch (field.type) {
            case "u8":
            case "i8":
            case "bool":
                view.setUint8(field.offset, value);
                break;
            case "u16":
            case "i16":
                view.setUint16(field.offset, value, true);
                break;
            case "u32":
            case "i32":
            case "enum":
            case "pointer":
            case "opaque":
                view.setUint32(field.offset, value, true);
                break;
            case "u64":
            case "i64":
                view.setBigUint64(field.offset, BigInt(value), true);
                break;
            case "f32":
                view.setFloat32(field.offset, value, true);
                break;
            default:
                throw new Error(`unsupported ${structName}.${fieldName} type ${field.type}`);
        }
    }

    allocStruct(name) {
        const size = this.layout[name].size;
        const ptr = this.alloc(size);
        this.bytes(ptr, size).fill(0);
        return { ptr, size, view: this.view(ptr, size) };
    }

    newHandle(exportName) {
        const out = this.exports.ghostty_wasm_alloc_opaque();
        const result = this.exports[exportName](0, out);
        const ptr = this.u32(out);
        this.exports.ghostty_wasm_free_opaque(out);
        return { result, ptr };
    }

    /** Install a JS function into the WASM funcref table. Returns 0 if unavailable. */
    async installCallback(fn, argc) {
        const table = this.exports.__indirect_function_table;
        if (!table || typeof table.grow !== "function") return 0;
        const wasmFn = await jsToWasmFn(fn, argc);
        const idx = table.grow(1);
        table.set(idx, wasmFn);
        return idx;
    }
}

function encodeLeb128(n) {
    const out = [];
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n) byte |= 0x80;
        out.push(byte);
    } while (n);
    return out;
}

function wasmSection(id, body) {
    return [id, ...encodeLeb128(body.length), ...body];
}

function nameBytes(s) {
    const bytes = Array.from(s).map((c) => c.charCodeAt(0));
    return [...encodeLeb128(bytes.length), ...bytes];
}

async function jsToWasmFn(fn, argc) {
    const typeBody = [1, 0x60, argc, ...Array(argc).fill(0x7f), 0];
    const importBody = [1, ...nameBytes("e"), ...nameBytes("f"), 0x00, 0x00];
    const tableBody = [1, 0x70, 0x00, 1];
    const exportBody = [1, ...nameBytes("t"), 0x01, 0x00];
    const elemBody = [1, 0x00, 0x41, 0x00, 0x0b, 1, 0x00];
    const bytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ...wasmSection(1, typeBody),
        ...wasmSection(2, importBody),
        ...wasmSection(4, tableBody),
        ...wasmSection(7, exportBody),
        ...wasmSection(9, elemBody),
    ]);
    const { instance } = await WebAssembly.instantiate(bytes, { e: { f: fn } });
    return instance.exports.t.get(0);
}
