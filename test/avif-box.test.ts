import { describe, expect, it } from "vitest";
import { patchNclx, patchSequenceHeaderCicp, readNclx, readSequenceHeaderCicp } from "../src/avif-box";
import { TEMPORAL_DELIMITER, obu, sequenceHeader, type SeqSpec } from "./support/av1";
import { avifLike, box, concat, ftyp, ispe, largeBox, metaWith, nclxColr } from "./support/avif-fixture";
import { avifWithItems, type LayoutOptions } from "./support/avif-items";

const enc = (s: string) => new TextEncoder().encode(s);

describe("nclx patch", () => {
  it("reads jSquash's colour box", () => {
    expect(readNclx(avifLike())).toEqual({ primaries: 2, transfer: 2, matrix: 6, fullRange: true });
  });

  it("marks the image BT.2020 PQ, keeping the matrix and range", () => {
    const bytes = avifLike();
    expect(patchNclx(bytes)).toBe(true);
    expect(readNclx(bytes)).toEqual({ primaries: 9, transfer: 16, matrix: 6, fullRange: true });
  });

  it("reports a file without a colour box", () => {
    const bytes = avifLike(false);
    expect(patchNclx(bytes)).toBe(false);
    expect(readNclx(bytes)).toBeNull();
  });
});

describe("nclx box bounds", () => {
  // The bytes after a short colr box belong to the next box; a patch that
  // trusted the nclx layout would write into them.
  it.each([6, 10])("refuses an nclx box with a %i-byte payload, and writes nothing", (payload) => {
    const neighbour = box("pixi", new Uint8Array(8).fill(7));
    const colr = box("colr", enc("nclx"), new Uint8Array(payload - 4).fill(1));
    const bytes = concat(ftyp(), metaWith([ispe(), colr, neighbour]));
    const before = bytes.slice();
    expect(readNclx(bytes)).toBeNull();
    expect(patchNclx(bytes)).toBe(false);
    expect(bytes).toEqual(before);
  });

  it("answers null for a largesize header with no room for the size", () => {
    const bytes = concat(ftyp(), Uint8Array.of(0, 0, 0, 1, ...enc("meta"), 0, 0, 0, 0));
    expect(readNclx(bytes)).toBeNull();
    expect(patchNclx(bytes)).toBe(false);
  });

  it("walks a meta box that uses the 64-bit size", () => {
    const bytes = concat(ftyp(), metaWith([ispe(), nclxColr()], largeBox));
    expect(readNclx(bytes)).toEqual({ primaries: 2, transfer: 2, matrix: 6, fullRange: true });
    expect(patchNclx(bytes)).toBe(true);
    expect(readNclx(bytes)).toMatchObject({ primaries: 9, transfer: 16 });
  });

  it("walks a last box whose size field is 0, meaning to the end of the file", () => {
    const meta = metaWith([ispe(), nclxColr()]);
    new DataView(meta.buffer).setUint32(0, 0);
    const bytes = concat(ftyp(), meta);
    expect(readNclx(bytes)).toMatchObject({ primaries: 2, matrix: 6 });
    expect(patchNclx(bytes)).toBe(true);
    expect(readNclx(bytes)).toMatchObject({ primaries: 9, transfer: 16 });
  });

  it("skips a profile colr box that comes before the nclx one", () => {
    const prof = box("colr", enc("prof"), new Uint8Array(24).fill(0xa5));
    const bytes = concat(ftyp(), metaWith([ispe(), prof, nclxColr()]));
    const at = bytes.indexOf(0xa5);
    expect(readNclx(bytes)).toEqual({ primaries: 2, transfer: 2, matrix: 6, fullRange: true });
    expect(patchNclx(bytes)).toBe(true);
    expect(readNclx(bytes)).toMatchObject({ primaries: 9, transfer: 16 });
    expect(Array.from(bytes.subarray(at, at + 24))).toEqual(new Array(24).fill(0xa5));
  });
});

describe("sequence header colour description in a file", () => {
  // An AVIF item's data: a temporal delimiter, the sequence header, a frame.
  const item = (colour: [number, number, number], spec: SeqSpec = { reduced: true }) =>
    concat(TEMPORAL_DELIMITER, obu(1, sequenceHeader({ ...spec, colour }).payload), obu(6, new Uint8Array(30).fill(0xee)));
  const primary = item([2, 3, 6]);
  const decoy = item([7, 8, 9]);

  it("reads and marks the header of the primary item", () => {
    const bytes = avifWithItems([{ id: 1, data: primary }]);
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    expect(patchSequenceHeaderCicp(bytes)).toBe(true);
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 9, transfer: 16, matrix: 6 });
    expect(bytes).toEqual(avifWithItems([{ id: 1, data: item([9, 16, 6]) }]));
  });

  it("takes other values when asked", () => {
    const bytes = avifWithItems([{ id: 1, data: primary }]);
    expect(patchSequenceHeaderCicp(bytes, 1, 18)).toBe(true);
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 1, transfer: 18, matrix: 6 });
  });

  it("follows pitm to the primary item, not the first data in mdat", () => {
    const bytes = avifWithItems([{ id: 1, data: decoy }, { id: 2, data: primary }], { primary: 2 });
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    const decoyAt = bytes.length - primary.length - decoy.length;
    expect(patchSequenceHeaderCicp(bytes)).toBe(true);
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 9, transfer: 16, matrix: 6 });
    expect(bytes.subarray(decoyAt, decoyAt + decoy.length)).toEqual(decoy);
  });

  // Whatever widths and version iloc is written with, the same item is found.
  const layouts: [string, LayoutOptions][] = [
    ["version 0", { version: 0 }],
    ["version 1", { version: 1 }],
    ["version 2 with 32-bit item ids", { version: 2 }],
    ["8-byte offsets and lengths", { version: 1, offsetSize: 8, lengthSize: 8 }],
    ["a base offset", { version: 0, baseOffsetSize: 4 }],
    ["an 8-byte base offset and no extent offset field", { version: 2, baseOffsetSize: 8, offsetSize: 0 }],
    ["a 4-byte extent index", { version: 1, indexSize: 4 }],
    ["an 8-byte extent index and 8-byte offsets", { version: 2, indexSize: 8, offsetSize: 8 }],
    ["a 32-bit pitm item id", { pitmVersion: 1 }],
  ];
  it.each(layouts)("finds the item with iloc %s", (_name, layout) => {
    const bytes = avifWithItems([{ id: 1, data: decoy }, { id: 2, data: primary }], { ...layout, primary: 2 });
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    expect(patchSequenceHeaderCicp(bytes)).toBe(true);
    expect(readSequenceHeaderCicp(bytes)).toEqual({ primaries: 9, transfer: 16, matrix: 6 });
  });

  // None of these can be marked, and a file that can't be must come back as it went in.
  const unusable: [string, () => Uint8Array][] = [
    ["a file without iloc", () => avifWithItems([{ id: 1, data: primary }], { withIloc: false })],
    ["a file without pitm", () => avifWithItems([{ id: 1, data: primary }], { primary: null })],
    ["a primary item that iloc doesn't list", () => avifWithItems([{ id: 1, data: primary }], { primary: 5 })],
    ["data that lives in another file", () => avifWithItems([{ id: 1, data: primary }], { dataReference: 1 })],
    ["data held in idat rather than in the file", () => avifWithItems([{ id: 1, data: primary }], { version: 1, constructionMethod: 1 })],
    ["an extent that runs past the end of the file", () => avifWithItems([{ id: 1, data: primary }], { lengthSlack: 100 })],
    ["item data that isn't AV1", () => avifWithItems([{ id: 1, data: new Uint8Array(40).fill(0xff) }])],
    ["item data cut off inside the sequence header", () => avifWithItems([{ id: 1, data: item([2, 3, 6]).slice(0, 4) }])],
    ["a file with no meta box", () => ftyp()],
    ["an empty file", () => new Uint8Array(0)],
  ];
  it.each(unusable)("returns false and changes nothing for %s", (_name, make) => {
    const bytes = make();
    const before = bytes.slice();
    expect(readSequenceHeaderCicp(bytes)).toBeNull();
    expect(patchSequenceHeaderCicp(bytes)).toBe(false);
    expect(bytes).toEqual(before);
  });
});
