import { describe, expect, it } from "vitest";
import type { FrameSample } from "../src/frame";
import { BINS_PER_STOP, HIST_MIN_STOPS, hdrHistogram } from "../src/histogram";
import { encodeGain } from "../src/model";
import { BAND_COLOURS, visualizePixel } from "../src/visualize";

function sample(w: number, h: number, rgb: [number, number, number]): FrameSample {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { data, width: w, height: h };
}
const gainOf = (g: number, headroom: number) => {
  const v = Math.round(encodeGain(1, g, headroom) * 255);
  return sample(4, 4, [v, v, v]);
};

describe("hdrHistogram", () => {
  it("puts SDR white in the last bin at or below 0 stops", () => {
    const h = hdrHistogram(sample(4, 4, [255, 255, 255]), sample(4, 4, [0, 0, 0]), 2);
    expect(h.minStops).toBe(HIST_MIN_STOPS);
    expect(h.maxStops).toBe(2);
    expect(h.firstHdrBin).toBe(-HIST_MIN_STOPS * BINS_PER_STOP);
    expect(h.bins[h.firstHdrBin - 1]).toBe(16);
  });

  it("puts a pixel lifted 1.375 stops past white in the HDR bin (1.25, 1.5]", () => {
    const h = hdrHistogram(sample(4, 4, [255, 255, 255]), gainOf(1.375, 2), 2);
    expect(h.bins[h.firstHdrBin + Math.ceil(1.375 * BINS_PER_STOP) - 1]).toBe(16);
  });

  it("places mid grey about 2.5 stops below white", () => {
    const h = hdrHistogram(sample(4, 4, [118, 118, 118]), sample(4, 4, [0, 0, 0]), 2);
    const bin = h.bins.findIndex((n) => n > 0);
    // 118/255 decodes to 0.18116, which is -2.4646 stops: the bin (-2.5, -2.25].
    const lower = bin / BINS_PER_STOP + HIST_MIN_STOPS;
    expect(lower).toBeCloseTo(-2.5, 10);
    expect(h.bins[bin]).toBe(16);
    expect(h.bins.reduce((a, b) => a + b, 0)).toBe(16);
  });
});

describe("visualizePixel", () => {
  it("dims SDR pixels to grey", () => {
    expect(visualizePixel([255, 255, 255], 0, 2)).toEqual([128, 128, 128]);
  });
  it("colours each stop above white", () => {
    const at = (g: number) => visualizePixel([255, 255, 255], Math.round(encodeGain(1, g, 4) * 255), 4);
    expect(at(0.5)).toEqual([...BAND_COLOURS[0]]);
    expect(at(1.5)).toEqual([...BAND_COLOURS[1]]);
    expect(at(2.5)).toEqual([...BAND_COLOURS[2]]);
    expect(at(3.5)).toEqual([...BAND_COLOURS[3]]);
  });
});
