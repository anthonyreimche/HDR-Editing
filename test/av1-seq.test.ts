import { describe, expect, it } from "vitest";
import { patchColourDescription, readColourDescription } from "../src/av1-seq";
import { TEMPORAL_DELIMITER, obu, sequenceHeader, type SeqSpec } from "./support/av1";
import { concat } from "./support/avif-fixture";

const header = (spec: SeqSpec) => obu(1, sequenceHeader(spec).payload);
const read = (bytes: Uint8Array) => readColourDescription(bytes, 0, bytes.length);

describe("AV1 sequence header colour description", () => {
  // Each case moves colour_primaries to a different bit, through a different
  // branch of the syntax before color_config.
  const cases: [string, SeqSpec][] = [
    ["a reduced still-picture header", { reduced: true }],
    ["a full header with one operating point", {}],
    ["timing info with an equal picture interval", { timing: { equalPictureInterval: true, decoderModel: false } }],
    ["timing info without one", { timing: { equalPictureInterval: false, decoderModel: false } }],
    [
      "a decoder model with per-point parameters",
      {
        timing: { equalPictureInterval: true, decoderModel: true },
        operatingPoints: [{ decoderModelPresent: true }, {}, { decoderModelPresent: true, level: 9, tier: true }],
      },
    ],
    [
      "three operating points, a tier bit and display delays",
      { displayDelay: true, operatingPoints: [{ level: 9, tier: true, displayDelay: true }, { level: 2 }, { idc: 0x103, level: 8, displayDelay: true }] },
    ],
    ["frame ids", { frameIds: true }],
    ["order hints", { orderHint: true }],
    ["order hints with screen content tools forced off", { orderHint: true, screenContent: 0 }],
    ["order hints with a forced integer mv", { orderHint: true, screenContent: 1, integerMv: 0 }],
    ["screen content tools forced on, integer mv forced", { screenContent: 1, integerMv: 1 }],
    ["screen content tools forced on, integer mv chosen", { screenContent: 1, integerMv: "choose" }],
    ["screen content tools forced off", { screenContent: 0 }],
    ["profile 1, which has no mono bit", { profile: 1 }],
    ["profile 2 at 12 bits", { profile: 2, highBitdepth: true, twelveBit: true }],
    ["profile 2 at 10 bits", { profile: 2, highBitdepth: true, twelveBit: false }],
    ["monochrome", { mono: true }],
  ];

  it.each(cases)("finds the colour description past %s", (_name, spec) => {
    const bytes = header({ ...spec, colour: [2, 3, 6] });
    expect(read(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    expect(patchColourDescription(bytes, 0, bytes.length, 9, 16)).toBe(true);
    expect(read(bytes)).toEqual({ primaries: 9, transfer: 16, matrix: 6 });
    // The same header authored with the new values, bit for bit: only the two
    // fields moved, and the matrix and everything else stayed.
    expect(bytes).toEqual(header({ ...spec, colour: [9, 16, 6] }));
  });

  it("is size-preserving and leaves the surrounding bytes alone", () => {
    const before = concat(TEMPORAL_DELIMITER, header({}), obu(6, new Uint8Array(40).fill(0xee)));
    const after = before.slice();
    expect(readColourDescription(after, 0, after.length)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    expect(patchColourDescription(after, 0, after.length, 9, 16)).toBe(true);
    expect(after.length).toBe(before.length);
    expect(after.subarray(before.length - 42)).toEqual(before.subarray(before.length - 42));
    expect(after.subarray(0, TEMPORAL_DELIMITER.length)).toEqual(TEMPORAL_DELIMITER);
  });

  describe("walking the OBUs", () => {
    it("skips a temporal delimiter and an OBU with a multi-byte size", () => {
      const bytes = concat(TEMPORAL_DELIMITER, obu(15, new Uint8Array(300)), header({}));
      expect(read(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
      expect(patchColourDescription(bytes, 0, bytes.length, 9, 16)).toBe(true);
      expect(read(bytes)?.primaries).toBe(9);
    });

    it("reads a size spread over padded leb128 bytes", () => {
      const payload = sequenceHeader({}).payload;
      expect(read(obu(1, payload, { sizeBytes: 3 }))).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    });

    it("reads an OBU with an extension byte", () => {
      expect(read(obu(1, sequenceHeader({}).payload, { extension: true }))).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    });

    it("reads a last OBU that has no size field, to the end of the data", () => {
      const bytes = concat(TEMPORAL_DELIMITER, obu(1, sequenceHeader({}).payload, { sizeField: false }));
      expect(read(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
    });

    it("stays inside the range it is given", () => {
      const inner = concat(TEMPORAL_DELIMITER, header({}));
      const decoy = header({ colour: [7, 7, 7] });
      const bytes = concat(decoy, inner, decoy);
      expect(readColourDescription(bytes, decoy.length, decoy.length + inner.length)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
      expect(patchColourDescription(bytes, decoy.length, decoy.length + inner.length, 9, 16)).toBe(true);
      expect(bytes.subarray(0, decoy.length)).toEqual(decoy);
      expect(bytes.subarray(decoy.length + inner.length)).toEqual(decoy);
    });
  });

  describe("input that is not a readable header", () => {
    const untouched = (bytes: Uint8Array) => {
      const before = bytes.slice();
      expect(read(bytes)).toBeNull();
      expect(patchColourDescription(bytes, 0, bytes.length, 9, 16)).toBe(false);
      expect(bytes).toEqual(before);
    };

    it("has no colour description to move when the flag is 0", () => {
      untouched(header({ colour: null }));
    });

    it("finds no sequence header among other OBUs", () => {
      untouched(concat(TEMPORAL_DELIMITER, obu(6, new Uint8Array(20))));
    });

    it("rejects the forbidden bit", () => {
      const bytes = header({});
      bytes[0] |= 0x80;
      untouched(bytes);
    });

    it("rejects an OBU whose size runs past the data", () => {
      const bytes = header({});
      untouched(bytes.subarray(0, bytes.length - 2));
    });

    it("rejects a leb128 size that never ends", () => {
      untouched(Uint8Array.of(0x0a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0, 0));
    });

    it("rejects empty data", () => {
      untouched(new Uint8Array(0));
    });

    // The colour description is 24 bits starting at colourBit; a header cut
    // before they end must be refused, and one cut after must not be.
    it("refuses a payload that ends before the description does, and reads one that ends after", () => {
      const { payload, colourBit } = sequenceHeader({});
      const needed = Math.ceil((colourBit + 24) / 8);
      for (let cut = 0; cut <= payload.length; cut++) {
        const bytes = obu(1, payload.subarray(0, cut));
        if (cut < needed) untouched(bytes);
        else expect(read(bytes)).toEqual({ primaries: 2, transfer: 3, matrix: 6 });
      }
    });

    // The range bit after the description is left out when the triple is
    // sRGB with the identity matrix, so rewriting either side of it would
    // change how the rest of the header parses.
    it("won't write into or out of the sRGB identity triple", () => {
      const srgb = header({ colour: [1, 13, 0] });
      expect(read(srgb)).toEqual({ primaries: 1, transfer: 13, matrix: 0 });
      const before = srgb.slice();
      expect(patchColourDescription(srgb, 0, srgb.length, 9, 16)).toBe(false);
      expect(srgb).toEqual(before);

      const identity = header({ colour: [9, 16, 0] });
      const kept = identity.slice();
      expect(patchColourDescription(identity, 0, identity.length, 1, 13)).toBe(false);
      expect(identity).toEqual(kept);
    });

    it("rejects values that do not fit in 8 bits", () => {
      const bytes = header({});
      const before = bytes.slice();
      expect(patchColourDescription(bytes, 0, bytes.length, 256, 16)).toBe(false);
      expect(patchColourDescription(bytes, 0, bytes.length, 9, -1)).toBe(false);
      expect(bytes).toEqual(before);
    });
  });
});
