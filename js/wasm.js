/**
 * Thin helpers around ghostty-vt.wasm: load, heap access, sized-struct fields.
 *
 * Uses libghostty-vt's typed WASM allocators (`ghostty_wasm_alloc_*`).
 * `ghostty_type_json` may be a flat struct map or schema-1 `{ types, abi }`.
 */
export class Wasm {
    /**
     * @param {WebAssembly.Instance} instance
     * @param {Record<string, any>} layout  struct map (schema-1 `types`, or flat)
     * @param {{ pointer_size?: number, usize_size?: number }} [abi]
     */
    constructor(instance, layout, abi = {}) {
        this.instance = instance;
        this.layout = layout;
        this.abi = {
            pointer_size: abi.pointer_size ?? 4,
            usize_size: abi.usize_size ?? 4,
        };
    }

    static instantiateImports() {
        let instance;
        return {
            env: {
                log: (ptr, len) => {
                    const heap = new Uint8Array(instance.exports.memory.buffer, ptr, len);
                    console.log("[wasm]", new TextDecoder().decode(heap));
                },
            },
            setInstance(value) {
                instance = value;
            },
        };
    }

    static fromInstance(instance) {
        const jsonPtr = instance.exports.ghostty_type_json();
        const mem = instance.exports.memory.buffer;
        const heap = new Uint8Array(mem, jsonPtr, Math.min(1 << 20, mem.byteLength - jsonPtr));
        const end = heap.indexOf(0);
        const parsed = JSON.parse(new TextDecoder().decode(heap.subarray(0, end === -1 ? heap.length : end)));
        const layout = parsed.types || parsed;
        const abi = parsed.abi || {};
        return new Wasm(instance, layout, abi);
    }

    static async load(url) {
        const bytes = await fetch(url).then((r) => {
            if (!r.ok) throw new Error(`failed to fetch ${url}: ${r.status}`);
            return r.arrayBuffer();
        });
        const imports = Wasm.instantiateImports();
        const result = await WebAssembly.instantiate(bytes, { env: imports.env });
        imports.setInstance(result.instance);
        return Wasm.fromInstance(result.instance);
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

    usize(ptr) {
        if (this.abi.usize_size === 8) {
            return Number(new DataView(this.buffer).getBigUint64(ptr, true));
        }
        return this.u32(ptr);
    }

    setUsize(ptr, value) {
        if (this.abi.usize_size === 8) {
            new DataView(this.buffer).setBigUint64(ptr, BigInt(value), true);
        } else {
            this.setU32(ptr, value);
        }
    }

    #must(ptr, what) {
        if (!ptr) throw new Error(`${what} failed`);
        return ptr;
    }

    /** Host-owned scratch buffer (`ghostty_wasm_alloc_u8_array`). */
    alloc(n) {
        if (!n) return 0;
        return this.#must(
            this.exports.ghostty_wasm_alloc_u8_array(n),
            `ghostty_wasm_alloc_u8_array(${n})`,
        );
    }

    free(ptr, n) {
        if (!ptr) return;
        this.exports.ghostty_wasm_free_u8_array(ptr, n);
    }

    allocU8() {
        return this.#must(this.exports.ghostty_wasm_alloc_u8(), "ghostty_wasm_alloc_u8");
    }

    freeU8(ptr) {
        if (ptr) this.exports.ghostty_wasm_free_u8(ptr);
    }

    allocU16() {
        return this.#must(
            this.exports.ghostty_wasm_alloc_u16_array(1),
            "ghostty_wasm_alloc_u16_array",
        );
    }

    freeU16(ptr) {
        if (ptr) this.exports.ghostty_wasm_free_u16_array(ptr, 1);
    }

    allocUsize() {
        return this.#must(this.exports.ghostty_wasm_alloc_usize(), "ghostty_wasm_alloc_usize");
    }

    freeUsize(ptr) {
        if (ptr) this.exports.ghostty_wasm_free_usize(ptr);
    }

    /** Read an opaque handle from a `ghostty_wasm_alloc_opaque` slot. */
    takeOpaque(slot) {
        if (this.abi.pointer_size === 8) {
            return Number(new DataView(this.buffer).getBigUint64(slot, true));
        }
        return this.u32(slot);
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
        const out = this.#must(
            this.exports.ghostty_wasm_alloc_opaque(),
            "ghostty_wasm_alloc_opaque",
        );
        const result = this.exports[exportName](0, out);
        const ptr = this.takeOpaque(out);
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
