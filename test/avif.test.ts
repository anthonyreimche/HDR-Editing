import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAvif10,
  encodeAvif10Raw,
  loadAvifEncoder,
  resetAvifEncoder,
  type AvifFactory,
  type AvifLoaders,
  type AvifModule,
} from "../src/avif";
import { patchNclx, patchSequenceHeaderCicp, readNclx, readSequenceHeaderCicp } from "../src/avif-box";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@jsquash", "avif", "codec", "enc");
let factoryCalls = 0;
const loaders: AvifLoaders = {
  factory: async () => {
    factoryCalls++;
    const spec = pathToFileURL(join(dir, "avif_enc.js")).href;
    return ((await import(/* @vite-ignore */ spec)) as { default: AvifFactory }).default;
  },
  wasm: () => readFile(join(dir, "avif_enc.wasm")),
};

function gradient10(w: number, h: number): Uint16Array {
  const px = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px.set([Math.round((x / (w - 1)) * 1023), Math.round((y / (h - 1)) * 1023), 341, 1023], i);
    }
  }
  return px;
}

const decoderDir = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@jsquash", "avif", "codec", "dec");

interface Decoded {
  data: ArrayLike<number>;
  width: number;
  height: number;
}
type DecoderFactory = (overrides: {
  noInitialRun: boolean;
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): WebAssembly.Exports;
}) => Promise<{ decode(data: ArrayBuffer, bitDepth: number): Decoded | null }>;

/** jSquash's own decoder (libavif + dav1d), 10-bit samples out. */
async function decode10(bytes: Uint8Array): Promise<Decoded> {
  const spec = pathToFileURL(join(decoderDir, "avif_dec.js")).href;
  const factory = ((await import(/* @vite-ignore */ spec)) as { default: DecoderFactory }).default;
  const compiled = await WebAssembly.compile(await readFile(join(decoderDir, "avif_dec.wasm")));
  const decoder = await factory({
    noInitialRun: true,
    // This glue is an older Emscripten build than the encoder's: it takes its
    // exports from the return value, so the instance is made synchronously.
    instantiateWasm: (imports, done) => {
      const instance = new WebAssembly.Instance(compiled, imports);
      done(instance);
      return instance.exports;
    },
  });
  const image = decoder.decode(bytes.slice().buffer, 10);
  if (!image) throw new Error("the decoder refused the file");
  return image;
}

describe("encodeAvif10", () => {
  afterEach(() => resetAvifEncoder());

  // The raw encoder is jSquash's file as it comes out. Its colour description
  // is what the patches are written against, so a jSquash update that moved it
  // would show here first.
  it("encodes 10-bit RGBA to an AVIF with jSquash's colour box, which patches to PQ", async () => {
    const out = await encodeAvif10Raw(gradient10(32, 24), 32, 24, 80, loaders);
    expect(new TextDecoder().decode(out.subarray(4, 12))).toBe("ftypavif");
    expect(readNclx(out)).toEqual({ primaries: 2, transfer: 2, matrix: 6, fullRange: true });
    expect(readSequenceHeaderCicp(out)).toEqual({ primaries: 2, transfer: 2, matrix: 6 });
    expect(patchNclx(out)).toBe(true);
    expect(readNclx(out)).toMatchObject({ primaries: 9, transfer: 16 });
  }, 60_000);

  it("marks both the colour box and the sequence header BT.2020 PQ", async () => {
    const out = await encodeAvif10(gradient10(32, 24), 32, 24, 80, loaders);
    expect(readNclx(out)).toEqual({ primaries: 9, transfer: 16, matrix: 6, fullRange: true });
    expect(readSequenceHeaderCicp(out)).toEqual({ primaries: 9, transfer: 16, matrix: 6 });
    // The callers that mark the box themselves find it done: same bytes.
    const again = out.slice();
    expect(patchNclx(again)).toBe(true);
    expect(patchSequenceHeaderCicp(again)).toBe(true);
    expect(again).toEqual(out);
  }, 60_000);

  it("changes nothing but those two fields, and the decoder reads the same pixels", async () => {
    const px = gradient10(64, 48);
    const raw = await encodeAvif10Raw(px, 64, 48, 80, loaders);
    const marked = await encodeAvif10(px, 64, 48, 80, loaders);
    expect(marked.length).toBe(raw.length);
    const changed = Array.from(raw.keys()).filter((i) => raw[i] !== marked[i]);
    // nclx primaries and transfer (one low byte each), and the sequence
    // header's 16 bits, which touch at most three bytes.
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(changed.length).toBeLessThanOrEqual(5);
    const expected = raw.slice();
    patchNclx(expected);
    patchSequenceHeaderCicp(expected);
    expect(marked).toEqual(expected);

    const before = await decode10(raw);
    const after = await decode10(marked);
    expect({ w: after.width, h: after.height }).toEqual({ w: 64, h: 48 });
    expect(Array.from(after.data)).toEqual(Array.from(before.data));
  }, 60_000);

  it("loads the encoder once", async () => {
    factoryCalls = 0;
    await encodeAvif10(gradient10(8, 8), 8, 8, 80, loaders);
    await encodeAvif10(gradient10(8, 8), 8, 8, 80, loaders);
    expect(factoryCalls).toBe(1);
  }, 60_000);

  it("refuses a view into a larger buffer", async () => {
    const big = new Uint16Array(8 * 8 * 4 * 2);
    await expect(encodeAvif10(big.subarray(4), 8, 8, 80, loaders)).rejects.toThrow();
  });
});

// An instance's linear memory grows with the largest photo it encoded and never
// shrinks, and an abort (out of memory, say) leaves the instance unusable, so
// each encode gets its own instance from the one compiled module and drops it.
describe("an encoder instance per encode", () => {
  afterEach(() => {
    resetAvifEncoder();
    vi.restoreAllMocks();
  });

  /** The real glue, recording each instance made from it; with `abortFirst`
   *  the first one aborts when it encodes. */
  function recording(abortFirst = false) {
    const made: AvifModule[] = [];
    const recorded: AvifLoaders = {
      factory: async () => {
        const glue = await loaders.factory();
        return async (overrides) => {
          const instance = await glue(overrides);
          const aborted: AvifModule = {
            encode: () => {
              throw new WebAssembly.RuntimeError("Aborted(OOM)");
            },
          };
          made.push(abortFirst && made.length === 0 ? aborted : instance);
          return made[made.length - 1];
        };
      },
      wasm: loaders.wasm,
    };
    return { recorded, made };
  }

  it("instantiates a fresh encoder for each encode, from one compile", async () => {
    const compile = vi.spyOn(WebAssembly, "compile");
    const { recorded, made } = recording();
    await encodeAvif10(gradient10(8, 8), 8, 8, 80, recorded);
    await encodeAvif10(gradient10(8, 8), 8, 8, 80, recorded);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(2);
    expect(made[1]).not.toBe(made[0]);
  }, 60_000);

  it("encodes with a new instance after an encode that aborted", async () => {
    const { recorded, made } = recording(true);
    await expect(encodeAvif10(gradient10(8, 8), 8, 8, 80, recorded)).rejects.toThrow("Aborted");
    const out = await encodeAvif10(gradient10(8, 8), 8, 8, 80, recorded);
    expect(readNclx(out)).toMatchObject({ primaries: 9, transfer: 16 });
    expect(made).toHaveLength(2);
  }, 60_000);
});

// (module (import "a" "b" (func))): compiles and links against the glue's
// imports, but exports nothing, so the glue's ready callback throws reading
// the missing memory export.
const unlinkable = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 97, 1, 98, 0, 0);

describe("loading the encoder", () => {
  afterEach(() => resetAvifEncoder());

  // The glue's ready promise never settles when instantiation fails, so the
  // load has to reject on its own account, or every export would wait forever.
  it("rejects when the wasm cannot be instantiated, and a later call loads it", async () => {
    const broken: AvifLoaders = { factory: loaders.factory, wasm: async () => unlinkable };
    await expect(loadAvifEncoder(broken)).rejects.toThrow();
    const out = await encodeAvif10(gradient10(8, 8), 8, 8, 80, loaders);
    expect(out.length).toBeGreaterThan(0);
  }, 3_000);

  it("retries after the wasm failed to load", async () => {
    let calls = 0;
    const flaky: AvifLoaders = {
      factory: loaders.factory,
      wasm: async () => {
        if (calls++ === 0) throw new Error("offline");
        return readFile(join(dir, "avif_enc.wasm"));
      },
    };
    await expect(loadAvifEncoder(flaky)).rejects.toThrow("offline");
    await expect(loadAvifEncoder(flaky)).resolves.toBeDefined();
    expect(calls).toBe(2);
  }, 3_000);
});
