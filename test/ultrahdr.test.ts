import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { encodeGreyJpeg } from "../src/jpeg-encode";
import { ascii, concat, parseJpeg, payloadOf, segment, startsWith } from "../src/jpeg";
import {
  ISO_NS,
  MPF_SIG,
  XMP_NS,
  assembleUltraHdr,
  fraction,
  gainMapXmp,
  isoGainMapPayload,
  isoVersionSegment,
  mpfSegment,
  primaryXmp,
} from "../src/ultrahdr";

const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** What each segment before the scan is, in file order; unknown ones by marker. */
function labels(bytes: Uint8Array): string[] {
  return parseJpeg(bytes).segments.map((s) => {
    const p = payloadOf(bytes, s);
    if (s.marker === 0xe0) return "jfif";
    if (s.marker === 0xe1 && startsWith(p, ascii("Exif\0\0"))) return "exif";
    if (s.marker === 0xe1 && startsWith(p, XMP_NS)) return "xmp";
    if (s.marker === 0xe2 && startsWith(p, ascii("ICC_PROFILE\0"))) return "icc";
    if (s.marker === 0xe2 && startsWith(p, ISO_NS)) return "iso";
    if (s.marker === 0xe2 && startsWith(p, MPF_SIG)) return "mpf";
    return s.marker.toString(16);
  });
}

/** Where the MPF index says the images are, and the container XMP's claim. */
function layout(out: Uint8Array) {
  const { segments } = parseJpeg(out);
  const mpf = segments.find((s) => s.marker === 0xe2 && startsWith(payloadOf(out, s), MPF_SIG))!;
  const xmp = segments.find((s) => s.marker === 0xe1 && startsWith(payloadOf(out, s), XMP_NS))!;
  const tiff = mpf.start + 8;
  return {
    primarySize: u32(out, tiff + 50 + 4),
    gainSize: u32(out, tiff + 66 + 4),
    gainStart: tiff + u32(out, tiff + 66 + 8),
    xmpLength: Number(/Item:Length="(\d+)"/.exec(new TextDecoder().decode(payloadOf(out, xmp)))![1]),
  };
}

describe("Ultra HDR metadata", () => {
  it("writes libultrahdr's XMP, byte for byte in length", () => {
    expect(new TextEncoder().encode(primaryXmp(66171)).length).toBe(923);
    expect(primaryXmp(66171)).toContain('Item:Length="66171"');
    expect(primaryXmp(1).indexOf('Item:Semantic="Primary"')).toBeLessThan(primaryXmp(1).indexOf('Item:Semantic="GainMap"'));
    expect(primaryXmp(1)).toContain('hdrgm:Version="1.0"');
    expect(new TextEncoder().encode(gainMapXmp(2)).length).toBe(539);
    expect(gainMapXmp(2.3)).toContain('hdrgm:GainMapMax="2.3"');
    expect(gainMapXmp(2.3)).toContain('hdrgm:HDRCapacityMax="2.3"');
    expect(gainMapXmp(2)).toContain('hdrgm:OffsetSDR="0.015625"');
  });

  it("writes the ISO 21496-1 version box for the primary", () => {
    expect(isoVersionSegment()).toEqual(
      hex("ff e2 00 22 75 72 6e 3a 69 73 6f 3a 73 74 64 3a 69 73 6f 3a 74 73 3a 32 31 34 39 36 3a 2d 31 00 00 00 00 00"),
    );
  });

  it("writes libultrahdr's ISO 21496-1 gain-map payload (headroom 2)", () => {
    expect(segment(0xe2, new Uint8Array([...ISO_NS, ...isoGainMapPayload(2)]))).toEqual(
      hex(`ff e2 00 5b 75 72 6e 3a 69 73 6f 3a 73 74 64 3a 69 73 6f 3a 74 73 3a 32 31 34 39 36 3a 2d 31 00
           00 00 00 00 40 00 00 00 00 00 00 00 01 00 00 00 02 00 00 00 01 00 00 00 00 00 00 00 01
           00 00 00 02 00 00 00 01 00 00 00 01 00 00 00 01 00 00 00 01 00 00 00 40 00 00 00 01 00 00 00 40`),
    );
  });

  it("states tenths exactly", () => {
    expect(fraction(2)).toEqual([2, 1]);
    expect(fraction(2.3)).toEqual([23, 10]);
    expect(fraction(0.5)).toEqual([1, 2]);
  });

  it("writes libultrahdr's MPF segment", () => {
    expect(mpfSegment(0x123456, 0x4321, 0x120000)).toEqual(
      hex(`ff e2 00 58 4d 50 46 00 4d 4d 00 2a 00 00 00 08 00 03 b0 00 00 07 00 00 00 04 30 31 30 30
           b0 01 00 04 00 00 00 01 00 00 00 02 b0 02 00 07 00 00 00 20 00 00 00 32 00 00 00 00
           00 03 00 00 00 12 34 56 00 00 00 00 00 00 00 00 00 00 00 00 00 00 43 21 00 12 00 00 00 00 00 00`),
    );
  });
});

describe("assembleUltraHdr", () => {
  function base(): Uint8Array {
    const grey = new Uint8Array(32 * 16).map((_, i) => (i % 32) * 8);
    const plain = encodeGreyJpeg(grey, 32, 16, 90);
    const exif = segment(0xe1, ascii("Exif\0\0MM"));
    const oldXmp = segment(0xe1, new Uint8Array([...XMP_NS, ...ascii("<old/>")]));
    const icc = segment(0xe2, ascii("ICC_PROFILE\0\x01\x01fake"));
    // Base JPEG as the core exports it: JFIF, then Exif, an XMP and an ICC of its own.
    const jfif = parseJpeg(plain).segments[0];
    return new Uint8Array([
      ...plain.subarray(0, jfif.end),
      ...exif,
      ...oldXmp,
      ...icc,
      ...plain.subarray(jfif.end),
    ]);
  }
  const gain = encodeGreyJpeg(new Uint8Array(32 * 16).fill(128), 32, 16, 90);

  it("orders the primary's segments and drops its old XMP", () => {
    const out = assembleUltraHdr(base(), gain, 2);
    const { scan } = parseJpeg(out);
    const kinds = labels(out);
    expect(kinds.slice(0, 5)).toEqual(["jfif", "exif", "xmp", "icc", "iso"]);
    expect(kinds[kinds.length - 1]).toBe("mpf");
    expect(kinds.filter((k) => k === "xmp")).toHaveLength(1);
    expect([out[scan], out[scan + 1]]).toEqual([0xff, 0xda]);
  });

  it("points MPF and the XMP directory at the gain map", () => {
    const out = assembleUltraHdr(base(), gain, 2);
    const { segments } = parseJpeg(out);
    const mpf = segments.find((s) => s.marker === 0xe2 && startsWith(payloadOf(out, s), MPF_SIG))!;
    const tiff = mpf.start + 8;
    const primarySize = u32(out, tiff + 50 + 4);
    const gainSize = u32(out, tiff + 66 + 4);
    const gainOffset = u32(out, tiff + 66 + 8);
    expect(u32(out, tiff + 50)).toBe(0x00030000);
    expect(u32(out, tiff + 50 + 8)).toBe(0);
    expect(tiff + gainOffset).toBe(primarySize);
    expect(primarySize + gainSize).toBe(out.length);
    expect([out[primarySize], out[primarySize + 1]]).toEqual([0xff, 0xd8]);
    const xmp = segments.find((s) => s.marker === 0xe1 && startsWith(payloadOf(out, s), XMP_NS))!;
    expect(new TextDecoder().decode(payloadOf(out, xmp))).toContain(`Item:Length="${gainSize}"`);
  });

  it("gives the gain map its own XMP and the full ISO metadata", () => {
    const out = assembleUltraHdr(base(), gain, 2);
    const mpfAt = parseJpeg(out).segments.find((s) => s.marker === 0xe2 && startsWith(payloadOf(out, s), MPF_SIG))!.start;
    const gainStart = u32(out, mpfAt + 8 + 50 + 4);
    const map = out.subarray(gainStart);
    const [xmp, iso] = parseJpeg(map).segments;
    expect(new TextDecoder().decode(payloadOf(map, xmp))).toContain('hdrgm:GainMapMax="2"');
    expect(payloadOf(map, iso)).toEqual(new Uint8Array([...ISO_NS, ...isoGainMapPayload(2)]));
  });

  it("leaves both images decodable", () => {
    const out = assembleUltraHdr(base(), gain, 2);
    expect(jpeg.decode(out, { useTArray: true }).width).toBe(32);
    const mpfAt = parseJpeg(out).segments.find((s) => s.marker === 0xe2 && startsWith(payloadOf(out, s), MPF_SIG))!.start;
    const gainStart = u32(out, mpfAt + 8 + 50 + 4);
    expect(jpeg.decode(out.subarray(gainStart), { useTArray: true }).height).toBe(16);
  });

  describe("headroom", () => {
    // The XMP and the ISO payload of the gain map, as written for a given headroom.
    function metadata(headroom: number) {
      const out = assembleUltraHdr(base(), gain, headroom);
      const map = out.subarray(layout(out).gainStart);
      const [xmp, iso] = parseJpeg(map).segments;
      return { xmp: new TextDecoder().decode(payloadOf(map, xmp)), iso: payloadOf(map, iso).subarray(ISO_NS.length) };
    }
    // alternate_hdr_headroom and gain_map_max, as numerator / denominator.
    const stated = (iso: Uint8Array) => [
      [u32(iso, 13), u32(iso, 17)],
      [u32(iso, 29), u32(iso, 33)],
    ];

    it("states the tenths it rounds to in both forms", () => {
      const { xmp, iso } = metadata(2.34);
      expect(xmp).toContain('hdrgm:GainMapMax="2.3"');
      expect(xmp).toContain('hdrgm:HDRCapacityMax="2.3"');
      expect(stated(iso)).toEqual([[23, 10], [23, 10]]);
      expect(iso).toEqual(isoGainMapPayload(2.3));
    });

    it("clamps to the 4-stop ceiling that the gain map was normalised by", () => {
      const { xmp, iso } = metadata(5);
      expect(xmp).toContain('hdrgm:GainMapMax="4"');
      expect(xmp).toContain('hdrgm:HDRCapacityMax="4"');
      expect(stated(iso)).toEqual([[4, 1], [4, 1]]);
    });

    it("clamps to the floor, so the base is never read as the HDR side", () => {
      const { xmp, iso } = metadata(0.04);
      expect(xmp).toContain('hdrgm:GainMapMax="0.5"');
      expect(xmp).toContain('hdrgm:HDRCapacityMax="0.5"');
      expect(stated(iso)).toEqual([[1, 2], [1, 2]]);
    });

    it("refuses a headroom that is not a number", () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        expect(() => assembleUltraHdr(base(), gain, bad)).toThrow("[hdr-editing]");
      }
    });
  });

  describe("inputs", () => {
    // The base JPEG with extra segments spliced in after its JFIF.
    function sdrWith(extra: Uint8Array[]): Uint8Array {
      const plain = encodeGreyJpeg(new Uint8Array(32 * 16).fill(100), 32, 16, 90);
      const jfif = parseJpeg(plain).segments[0];
      return concat([plain.subarray(0, jfif.end), ...extra, plain.subarray(jfif.end)]);
    }

    it("cuts the primary at its EOI, so re-assembling replaces the old gain map", () => {
      const first = assembleUltraHdr(base(), gain, 2);
      expect(assembleUltraHdr(first, gain, 2)).toEqual(first);

      const bigger = encodeGreyJpeg(new Uint8Array(64 * 32).map((_, i) => (i * 7) % 256), 64, 32, 90);
      const again = assembleUltraHdr(first, bigger, 2);
      expect(again).toEqual(assembleUltraHdr(base(), bigger, 2));
      const { primarySize, gainSize, gainStart, xmpLength } = layout(again);
      expect(primarySize + gainSize).toBe(again.length);
      expect(gainStart).toBe(primarySize);
      expect(xmpLength).toBe(gainSize);
    });

    it("refuses a primary with no EOI", () => {
      const cut = base().subarray(0, base().length - 2);
      expect(() => assembleUltraHdr(cut, gain, 2)).toThrow("[hdr-editing]");
    });

    it("refuses a gain map that does not start with SOI", () => {
      expect(() => assembleUltraHdr(base(), new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 2)).toThrow("[hdr-editing]");
      expect(() => assembleUltraHdr(base(), new Uint8Array(), 2)).toThrow("[hdr-editing]");
    });

    it("drops an MPF index and an ISO box the input already carries", () => {
      const oldMpf = segment(0xe2, new Uint8Array([...MPF_SIG, 1, 2, 3, 4]));
      const oldIso = segment(0xe2, new Uint8Array([...ISO_NS, 0, 0, 0, 0]));
      const kinds = labels(assembleUltraHdr(sdrWith([oldMpf, oldIso]), gain, 2));
      expect(kinds.filter((k) => k === "mpf")).toHaveLength(1);
      expect(kinds.filter((k) => k === "iso")).toHaveLength(1);
      expect(kinds[kinds.length - 1]).toBe("mpf");
    });

    it("keeps every ICC chunk and the APP13 and COM segments, in order", () => {
      const plain = encodeGreyJpeg(new Uint8Array(32 * 16).fill(100), 32, 16, 90);
      const tables = parseJpeg(plain).segments.slice(1).map((s) => s.marker.toString(16));
      const out = assembleUltraHdr(
        sdrWith([
          segment(0xe2, ascii("ICC_PROFILE\0\x01\x02one")),
          segment(0xed, ascii("Photoshop 3.0\0")),
          segment(0xe2, ascii("ICC_PROFILE\0\x02\x02two")),
          segment(0xfe, ascii("a comment")),
        ]),
        gain,
        2,
      );
      expect(labels(out)).toEqual(["jfif", "xmp", "icc", "icc", "iso", "ed", "fe", ...tables, "mpf"]);
      const chunks = parseJpeg(out)
        .segments.filter((s) => s.marker === 0xe2 && startsWith(payloadOf(out, s), ascii("ICC_PROFILE\0")))
        .map((s) => new TextDecoder().decode(payloadOf(out, s).subarray(14)));
      expect(chunks).toEqual(["one", "two"]);
    });
  });
});
