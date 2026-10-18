import { describe, expect, it } from "vitest";
import type { FrameSample } from "../src/frame";
import { encodeGain, OFFSET } from "../src/model";
import { BAND_COLOURS, visualizeImage, visualizePixel } from "../src/visualize";

const WHITE = [255, 255, 255];
const byteFor = (stops: number, headroom: number) => Math.round(encodeGain(1, stops, headroom) * 255);
/** Stops above SDR white of a white pixel at a gain byte, written out longhand. */
const stopsAt = (byte: number, headroom: number) =>
  Math.log2((1 + OFFSET) * Math.pow(2, (byte / 255) * headroom) - OFFSET);

describe("visualizePixel bands", () => {
  it("steps to the next colour just above each whole stop", () => {
    // Bands are (0, 1], (1, 2], (2, 3], (3, 4]; the margin is above the 8-bit step of the gain map.
    for (let band = 0; band < 4; band++) {
      expect(visualizePixel(WHITE, byteFor(band + 0.05, 4), 4)).toEqual([...BAND_COLOURS[band]]);
      expect(visualizePixel(WHITE, byteFor(band + 0.95, 4), 4)).toEqual([...BAND_COLOURS[band]]);
    }
  });

  it("agrees with ceil(stops) - 1 for every gain byte", () => {
    for (let byte = 0; byte < 256; byte++) {
      const e = stopsAt(byte, 4);
      const got = visualizePixel(WHITE, byte, 4);
      if (e <= 0.01) expect(got).toEqual([128, 128, 128]);
      else expect(got).toEqual([...BAND_COLOURS[Math.min(3, Math.ceil(e) - 1)]]);
    }
  });

  it("clamps anything past four stops to the top band", () => {
    // The offset lets a full gain byte on white read 4.02 stops.
    expect(stopsAt(255, 4)).toBeGreaterThan(4);
    expect(visualizePixel(WHITE, 255, 4)).toEqual([...BAND_COLOURS[3]]);
  });

  it("treats up to 0.01 stops as SDR and anything above as the first band", () => {
    // At 0.5 stops of headroom one gain byte is about 0.002 stops, so the
    // epsilon falls between bytes 5 (0.00996) and 6 (0.01195).
    expect(stopsAt(5, 0.5)).toBeLessThanOrEqual(0.01);
    expect(stopsAt(6, 0.5)).toBeGreaterThan(0.01);
    expect(visualizePixel(WHITE, 5, 0.5)).toEqual([128, 128, 128]);
    expect(visualizePixel(WHITE, 6, 0.5)).toEqual([...BAND_COLOURS[0]]);
  });

  it("keeps a lifted pixel that is still below SDR white grey", () => {
    // Mid grey lifted half a stop is still about 2 stops under white.
    const s = Math.pow((118 / 255 + 0.055) / 1.055, 2.4);
    const byte = Math.round(encodeGain(s, 0.5, 2) * 255);
    expect(byte).toBeGreaterThan(0);
    expect(visualizePixel([118, 118, 118], byte, 2)).toEqual([59, 59, 59]);
  });
});

describe("visualizeImage", () => {
  it("equals visualizePixel on every pixel of a mixed frame", () => {
    const w = 16;
    const h = 8;
    const sdr = new Uint8ClampedArray(w * h * 4);
    const gain = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // The first half sweeps the gain over white so every band occurs; the rest is arbitrary colour.
      const white = i < w * h / 2;
      const rgb = white ? [255, 255, 255] : [(i * 37) % 256, (i * 91 + 20) % 256, (i * 13 + 200) % 256];
      const v = white ? Math.round((i / (w * h / 2 - 1)) * 255) : (i * 2) % 256;
      sdr.set([...rgb, 255], i * 4);
      gain.set([v, v, v, 255], i * 4);
    }
    const a: FrameSample = { data: sdr, width: w, height: h };
    const b: FrameSample = { data: gain, width: w, height: h };
    const out = visualizeImage(a, b, 3);
    expect(out).toHaveLength(w * h * 4);
    const seen = new Set<string>();
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const px = visualizePixel([sdr[o], sdr[o + 1], sdr[o + 2]], gain[o], 3);
      expect([out[o], out[o + 1], out[o + 2], out[o + 3]]).toEqual([...px, 255]);
      seen.add(px.join());
    }
    // A frame of one colour would prove little: every band must have occurred.
    for (const band of BAND_COLOURS) expect(seen.has(band.join())).toBe(true);
  });
});
