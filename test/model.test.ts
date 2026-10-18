import { describe, expect, it } from "vitest";
import {
  OFFSET,
  decodeHdr,
  encodeGain,
  encodeSrgbExtended,
  gainMapValue,
  gainStops,
  gate,
  quantizeHeadroom,
  rho,
  sdrLuminance,
  type GainParams,
} from "../src/model";
import { FIELDS, paramsPatch, readParams, type GainKey } from "../src/params";

const P: GainParams = { on: true, headroom: 2, start: -0.25, rolloff: 1.5, protection: 50 };
const k = Math.pow(2, P.start);

describe("rho", () => {
  it("is 0 at and below the start, with zero slope there", () => {
    expect(rho(0, P.start, P.rolloff)).toBe(0);
    expect(rho(k * 0.5, P.start, P.rolloff)).toBe(0);
    expect(rho(k, P.start, P.rolloff)).toBe(0);
    const eps = 1e-4;
    expect(rho(k * Math.pow(2, eps), P.start, P.rolloff) / eps).toBeLessThan(1e-3);
  });

  it("reaches 0.80 at `rolloff` stops above the start, and climbs toward 1", () => {
    expect(rho(k * Math.pow(2, P.rolloff), P.start, P.rolloff)).toBeCloseTo(1 - 4 * Math.exp(-3), 12);
    expect(rho(k * 1024, P.start, P.rolloff)).toBeGreaterThan(0.999);
  });

  it("rises monotonically with the scene", () => {
    let last = -1;
    for (let x = 0; x < 50; x += 0.01) {
      const r = rho(x, P.start, P.rolloff);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("gate", () => {
  it("lets every pixel through with protection off", () => {
    expect(gate(0, 0)).toBe(1);
    expect(gate(0.01, 0)).toBe(1);
  });
  it("holds back pixels the SDR edit left dark", () => {
    expect(gate(0.1, 50)).toBe(0);
    expect(gate(0.25, 50)).toBe(1);
    expect(gate(0.2, 100)).toBe(0);
    expect(gate(0.5, 100)).toBe(1);
  });
});

describe("headroom", () => {
  it("is quantised to tenths inside [0.5, 4]", () => {
    expect(quantizeHeadroom(2.33)).toBe(2.3);
    expect(quantizeHeadroom(2.35)).toBe(2.4);
    expect(quantizeHeadroom(0.2)).toBe(0.5);
    expect(quantizeHeadroom(9)).toBe(4);
  });
});

describe("gainStops", () => {
  it("is 0 with HDR off, and below the start", () => {
    expect(gainStops(1, 100, { ...P, on: false })).toBe(0);
    expect(gainStops(1, k, P)).toBe(0);
  });
  it("approaches the headroom for bright scene values that ended near white", () => {
    expect(gainStops(1, 1000, P)).toBeGreaterThan(P.headroom * 0.999);
    expect(gainStops(1, 1000, P)).toBeLessThanOrEqual(P.headroom);
  });
});

describe("the encoded gain map", () => {
  it("uses the 1/64 offsets the Ultra HDR and ISO metadata state", () => {
    expect(OFFSET).toBe(1 / 64);
  });

  it("decodes back to the intended HDR luminance (luminance exact, offsets corrected)", () => {
    for (const s of [0.05, 0.2, 0.5, 0.9, 1]) {
      for (const g of [0, 0.5, 1.3, 2]) {
        const r = encodeGain(s, g, 2);
        expect(decodeHdr(s, r, 2, 1)).toBeCloseTo(s * Math.pow(2, g), 12);
      }
    }
  });

  it("stays within 8-bit quantisation after rounding to a byte", () => {
    const s = 0.8;
    const g = 1.37;
    const r8 = Math.round(encodeGain(s, g, 2) * 255) / 255;
    const want = s * Math.pow(2, g);
    // A byte's half-step is a fixed ratio in the offset domain (sdr + 1/64);
    // measured against the plain luminance it grows by (want + OFFSET) / want.
    const bound = (Math.pow(2, 2 / 510) - 1) * (1 + OFFSET / want);
    expect(Math.abs(decodeHdr(s, r8, 2, 1) / want - 1)).toBeLessThan(bound + 1e-9);
  });

  it("is exactly 0 where there is no gain", () => {
    expect(encodeGain(0.4, 0, 2)).toBe(0);
    expect(encodeGain(0, 0, 2)).toBe(0);
    expect(gainMapValue([0.5, 0.5, 0.5], 0.1, P)).toBe(0);
  });

  it("scales the lift with the display weight", () => {
    const r = encodeGain(1, 2, 2);
    // Half the weight lands on the geometric midpoint (in the offset domain).
    expect(decodeHdr(1, r, 2, 0.5)).toBeCloseTo(Math.sqrt((1 + OFFSET) * (4 + OFFSET)) - OFFSET, 12);
    expect(decodeHdr(1, r, 2, 0)).toBeCloseTo(1, 12);
  });
});

describe("out-of-range stage inputs", () => {
  // The core binds bag values as stored, so the stage clamps them to the
  // fields' ranges, as readParams does; the twin clamps the same way.
  const range = (key: GainKey) => FIELDS.find((f) => f.key === key)!;

  it("clamps the start and the roll-off to their fields' ranges", () => {
    const start = range("start");
    const rolloff = range("rolloff");
    for (const x of [0.05, 0.5, 1, 3, 20]) {
      expect(rho(x, start.min - 2, rolloff.min / 4)).toBe(rho(x, start.min, rolloff.min));
      expect(rho(x, start.max + 1, rolloff.max * 3)).toBe(rho(x, start.max, rolloff.max));
    }
    expect(Number.isFinite(rho(4, P.start, 0))).toBe(true);
  });

  it("clamps the protection to its field's range", () => {
    const protection = range("protection");
    for (const s of [0.05, 0.2, 0.3, 0.4, 0.6, 0.9]) {
      expect(gate(s, protection.max + 50)).toBe(gate(s, protection.max));
      expect(gate(s, protection.min - 20)).toBe(gate(s, protection.min));
    }
  });

  it("encodes a raw out-of-range bag as readParams would read it", () => {
    const raw: GainParams = { on: true, headroom: 9, start: -9, rolloff: 0, protection: 400 };
    const read = readParams(paramsPatch(raw));
    for (const c of [[0.3, 0.3, 0.3], [0.8, 0.7, 0.6], [1, 1, 1]]) {
      for (const x of [0.5, 2, 8]) expect(gainMapValue(c, x, raw)).toBe(gainMapValue(c, x, read));
    }
  });
});

describe("sRGB helpers", () => {
  it("reads the SDR pixel's luminance in linear light", () => {
    expect(sdrLuminance([1, 1, 1])).toBeCloseTo(1, 12);
    expect(sdrLuminance([2, -1, 0.5])).toBeCloseTo(sdrLuminance([1, 0, 0.5]), 12);
  });
  it("encodes past white and below black without a ceiling, keeping the sign", () => {
    expect(encodeSrgbExtended(1)).toBeCloseTo(1, 12);
    expect(encodeSrgbExtended(4)).toBeCloseTo(1.055 * Math.pow(4, 1 / 2.4) - 0.055, 12);
    expect(encodeSrgbExtended(-0.5)).toBeCloseTo(-encodeSrgbExtended(0.5), 12);
  });
});
