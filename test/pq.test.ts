import { describe, expect, it } from "vitest";
import { DECODE, type FrameSample } from "../src/frame";
import { OFFSET, quantizeHeadroom } from "../src/model";
import { REC709_TO_REC2020, REFERENCE_WHITE, hdrToPq10, pqEncode } from "../src/pq";

const one = (rgb: [number, number, number]): FrameSample => ({ data: Uint8ClampedArray.of(...rgb, 255), width: 1, height: 1 });

describe("PQ", () => {
  it("matches the ST 2084 curve at known luminances", () => {
    expect(pqEncode(0)).toBeLessThan(1e-6);
    expect(pqEncode(1)).toBeCloseTo(1, 12);
    expect(pqEncode(100 / 10000)).toBeCloseTo(0.5081, 3);
    expect(pqEncode(203 / 10000)).toBeCloseTo(0.5807, 3);
    expect(pqEncode(1000 / 10000)).toBeCloseTo(0.7518, 3);
  });

  it("keeps the BT.2087 matrix's rows summing to 1, so grey stays grey", () => {
    for (let r = 0; r < 3; r++) {
      expect(REC709_TO_REC2020[r * 3] + REC709_TO_REC2020[r * 3 + 1] + REC709_TO_REC2020[r * 3 + 2]).toBeCloseTo(1, 5);
    }
  });

  it("puts SDR white at the reference white, and lifts it by the gain map", () => {
    const white = hdrToPq10(one([255, 255, 255]), one([0, 0, 0]), 2);
    expect(Array.from(white)).toEqual([...Array(3).fill(Math.round(pqEncode(REFERENCE_WHITE / 10000) * 1023)), 1023]);
    const lifted = hdrToPq10(one([255, 255, 255]), one([255, 255, 255]), 2);
    const nits = ((1 + OFFSET) * 4 - OFFSET) * REFERENCE_WHITE;
    expect(lifted[0]).toBe(Math.round(pqEncode(nits / 10000) * 1023));
  });

  // The cases above build their expectations from REFERENCE_WHITE and from the
  // matrix export, so a wrong constant or a transposed matrix would follow
  // along. These two use literals from BT.2408 and BT.2087.
  it("places SDR white at 203 cd/m² (BT.2408)", () => {
    expect(REFERENCE_WHITE).toBe(203);
  });

  it("moves each Rec.709 primary to its BT.2087 column of Rec.2020", () => {
    const columns = [
      [0.627404, 0.069097, 0.016391],
      [0.329283, 0.91954, 0.088013],
      [0.043313, 0.011362, 0.895595],
    ];
    const code = (linear: number) => Math.round(pqEncode((linear * 203) / 10000) * 1023);
    const primaries: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    primaries.forEach((rgb, c) => {
      const out = hdrToPq10(one(rgb), one([0, 0, 0]), 2);
      expect(Array.from(out)).toEqual([...columns[c].map(code), 1023]);
    });
  });

  it("allocates its own buffer (jSquash reads the whole buffer)", () => {
    const out = hdrToPq10(one([10, 20, 30]), one([0, 0, 0]), 2);
    expect(out.byteOffset).toBe(0);
    expect(out.byteLength).toBe(out.buffer.byteLength);
  });
});

describe("hdrToPq10 inputs", () => {
  // The gain map is read by pixel index, so a map of another size would pair
  // each pixel with the wrong gain (or none) without any error.
  it("refuses a gain map that is not the image's size", () => {
    const frame = (width: number, height: number): FrameSample => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
    const sdr = frame(2, 2);
    expect(() => hdrToPq10(sdr, frame(1, 1), 2)).toThrow("[hdr-editing]"); // smaller
    expect(() => hdrToPq10(sdr, frame(2, 1), 2)).toThrow("[hdr-editing]"); // same width, shorter
    expect(() => hdrToPq10(sdr, frame(4, 1), 2)).toThrow("[hdr-editing]"); // same pixel count, other shape
    expect(() => hdrToPq10(sdr, frame(2, 2), 2)).not.toThrow();
  });
});

// hdrToPq10 as v1.0 wrote it, a Math.pow per channel per pixel: the oracle the
// table-driven conversion must match code for code.
function referencePq10(sdr: FrameSample, gain: FrameSample, headroom: number): Uint16Array {
  const h = quantizeHeadroom(headroom);
  const out = new Uint16Array(sdr.width * sdr.height * 4);
  const m = REC709_TO_REC2020;
  for (let i = 0; i < sdr.width * sdr.height; i++) {
    const o = i * 4;
    const g = Math.pow(2, (gain.data[o] / 255) * h);
    const [r, gr, b] = [0, 1, 2].map((c) => (DECODE[sdr.data[o + c]] + OFFSET) * g - OFFSET);
    const wide = [m[0] * r + m[1] * gr + m[2] * b, m[3] * r + m[4] * gr + m[5] * b, m[6] * r + m[7] * gr + m[8] * b];
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(pqEncode((Math.max(wide[c], 0) * REFERENCE_WHITE) / 10000) * 1023);
    out[o + 3] = 1023;
  }
  return out;
}

describe("hdrToPq10 against the per-pixel formula", () => {
  /** Every SDR value of each channel against every gain value, and a seeded
   *  scatter of colours. */
  function sweep(): { sdr: FrameSample; gain: FrameSample } {
    const w = 256;
    const h = 256 * 3 + 256;
    const sdr = new Uint8ClampedArray(w * h * 4);
    const gain = new Uint8ClampedArray(w * h * 4);
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) & 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const block = y >> 8;
        const rgb = block < 3 ? [0, 1, 2].map((c) => (c === block ? x : 0)) : [rand(), rand(), rand()];
        sdr.set([...rgb, 255], o);
        gain[o] = block < 3 ? y & 255 : rand();
      }
    }
    return { sdr: { data: sdr, width: w, height: h }, gain: { data: gain, width: w, height: h } };
  }

  it.each([0.5, 1, 1.37, 2, 3.3, 4])("matches it at headroom %s", (headroom) => {
    const { sdr, gain } = sweep();
    const got = hdrToPq10(sdr, gain, headroom);
    const want = referencePq10(sdr, gain, headroom);
    const first = got.findIndex((v, i) => v !== want[i]);
    expect(first).toBe(-1);
  });

  it("gives black with no lift code 0", () => {
    expect(Array.from(hdrToPq10(one([0, 0, 0]), one([0, 0, 0]), 4))).toEqual([0, 0, 0, 1023]);
  });
});
