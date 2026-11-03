import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { encodeAvif10, resetAvifEncoder } from "../src/avif";
import { readNclx, readSequenceHeaderCicp } from "../src/avif-box";
import { addExif, itemData, readExif } from "../src/avif-exif";
import { nodeAvifLoaders } from "./support/node-avif";
import { DEFAULT_ITEMS, avifForExif, type ExifFixtureOptions } from "./support/avif-exif-fixture";
import { box, concat, ftyp } from "./support/avif-fixture";

// A little-endian TIFF block with one Orientation entry.
const TIFF = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);

const decoderDir = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@jsquash", "avif", "codec", "dec");

type DecoderFactory = (overrides: {
  noInitialRun: boolean;
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): WebAssembly.Exports;
}) => Promise<{ decode(data: ArrayBuffer, bitDepth: number): { data: ArrayLike<number>; width: number; height: number } | null }>;

/** jSquash's own decoder (libavif + dav1d), 10-bit samples out. */
async function decode10(bytes: Uint8Array) {
  const spec = pathToFileURL(join(decoderDir, "avif_dec.js")).href;
  const factory = ((await import(/* @vite-ignore */ spec)) as { default: DecoderFactory }).default;
  const compiled = await WebAssembly.compile(await readFile(join(decoderDir, "avif_dec.wasm")));
  const decoder = await factory({
    noInitialRun: true,
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

/** The top-level boxes of a file, which must tile it exactly. */
function topLevel(bytes: Uint8Array): { type: string; start: number; end: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { type: string; start: number; end: number }[] = [];
  let at = 0;
  while (at < bytes.length) {
    const size = view.getUint32(at);
    expect(size).toBeGreaterThanOrEqual(8);
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, end: at + size });
    at += size;
  }
  expect(at).toBe(bytes.length);
  return out;
}

describe("addExif on a real jSquash AVIF", () => {
  const w = 32;
  const h = 24;
  const pixels = () => {
    const px = new Uint16Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([i % 1023, 300, 500, 1023], i * 4);
    return px;
  };

  it("adds the Exif item without touching the image: same pixels, same colour description", async () => {
    const original = await encodeAvif10(pixels(), w, h, 80, nodeAvifLoaders);
    resetAvifEncoder();
    const out = addExif(original, TIFF);
    expect(out).not.toBeNull();
    const file = out!;

    expect(readExif(file)).toEqual({ tiff: TIFF, describes: 1 });
    expect(topLevel(file).map((b) => b.type)).toEqual(["ftyp", "meta", "mdat", "mdat"]);
    expect(readNclx(file)).toEqual(readNclx(original));
    expect(readSequenceHeaderCicp(file)).toEqual(readSequenceHeaderCicp(original));
    expect(itemData(file).get(1)).toEqual(itemData(original).get(1));

    const before = await decode10(original);
    const after = await decode10(file);
    expect([after.width, after.height]).toEqual([w, h]);
    expect(Array.from(after.data)).toEqual(Array.from(before.data));
  }, 60_000);

  it("leaves the file it was given alone", async () => {
    const original = await encodeAvif10(pixels(), w, h, 80, nodeAvifLoaders);
    resetAvifEncoder();
    const copy = original.slice();
    addExif(original, TIFF);
    expect(original).toEqual(copy);
  }, 60_000);
});

describe("addExif on the item tables", () => {
  const layouts: [string, ExifFixtureOptions][] = [
    ["iloc version 0, 4-byte fields", {}],
    ["iloc version 1", { ilocVersion: 1 }],
    ["iloc version 2, 32-bit item ids", { ilocVersion: 2 }],
    ["8-byte offsets and lengths", { offsetSize: 8, lengthSize: 8 }],
    ["a base offset, with the extent offset relative to it", { baseOffsetSize: 4 }],
    ["an extent index", { ilocVersion: 1, indexSize: 4 }],
    ["iinf version 1", { iinfVersion: 1 }],
    ["an iref the alpha plane already uses", { iref: true }],
    ["an iref of version 1", { iref: true, irefVersion: 1 }],
  ];

  it.each(layouts)("keeps every item's data where its iloc says, with %s", (_name, options) => {
    const original = avifForExif(options);
    const out = addExif(original, TIFF);
    expect(out).not.toBeNull();
    const file = out!;
    for (const item of DEFAULT_ITEMS) expect(itemData(file).get(item.id)).toEqual(item.data);
    expect(readExif(file)).toEqual({ tiff: TIFF, describes: 1 });
    topLevel(file);
  });

  it("numbers the new item after the ones there", () => {
    const out = addExif(avifForExif({ items: [{ id: 7, data: Uint8Array.of(1, 2, 3) }, { id: 9, data: Uint8Array.of(4, 5) }] }), TIFF)!;
    expect(Array.from(itemData(out).keys()).sort((a, b) => a - b)).toEqual([7, 9, 10]);
    expect(readExif(out)).toEqual({ tiff: TIFF, describes: 7 });
  });

  it("keeps a box that follows mdat", () => {
    const trailing = box("free", new Uint8Array(12).fill(3));
    const out = addExif(avifForExif({ trailing }), TIFF)!;
    const boxes = topLevel(out);
    expect(boxes.map((b) => b.type)).toEqual(["ftyp", "meta", "mdat", "free", "mdat"]);
    for (const item of DEFAULT_ITEMS) expect(itemData(out).get(item.id)).toEqual(item.data);
  });

  it("answers null, rather than guess, for a layout it doesn't understand", () => {
    const original = avifForExif();
    expect(addExif(original.subarray(0, 20), TIFF)).toBeNull();
    expect(addExif(concat(ftyp(), box("mdat", new Uint8Array(4))), TIFF)).toBeNull();
    expect(addExif(new Uint8Array(0), TIFF)).toBeNull();
    expect(addExif(avifForExif({ offsetSize: 4 }), new Uint8Array(0))).toBeNull();
    // A last box of size 0 runs to the end of the file; one appended after it would be inside it.
    const open = original.slice();
    const mdatAt = topLevelStart(open, "mdat");
    new DataView(open.buffer).setUint32(mdatAt, 0);
    expect(addExif(open, TIFF)).toBeNull();
  });
});

function topLevelStart(bytes: Uint8Array, type: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 8 <= bytes.length; at += view.getUint32(at)) {
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === type) return at;
  }
  throw new Error(`no ${type}`);
}

describe("readExif", () => {
  it("finds nothing in a file without an Exif item", () => {
    expect(readExif(avifForExif())).toBeNull();
    expect(readExif(new Uint8Array(0))).toBeNull();
  });
});
