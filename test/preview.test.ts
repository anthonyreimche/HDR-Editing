import { describe, expect, it } from "vitest";
import { decodeHdr, decodeSrgb, encodeSrgbExtended, OFFSET } from "../src/model";
import { detectPreviewSupport } from "../src/preview-support";
import { PREVIEW_WGSL, displayWeight, previewPixel } from "../src/preview-wgsl";

describe("preview composite (TS twin of the WGSL)", () => {
  it("shows the SDR pixel at weight 0", () => {
    const [r] = previewPixel([200, 100, 50], 255, 2, 0);
    expect(r).toBeCloseTo(200 / 255, 6);
  });

  it("lifts white past 1 at full weight", () => {
    const [r] = previewPixel([255, 255, 255], 255, 2, 1);
    expect(r).toBeCloseTo(encodeSrgbExtended((1 + OFFSET) * 4 - OFFSET), 9);
    expect(r).toBeGreaterThan(1);
  });

  it("weights the lift by the display's headroom", () => {
    expect(displayWeight(2, 2)).toBe(1);
    expect(displayWeight(1, 2)).toBe(0.5);
    expect(displayWeight(4, 2)).toBe(1);
    const [half] = previewPixel([255, 255, 255], 255, 2, displayWeight(1, 2));
    expect(half).toBeCloseTo(encodeSrgbExtended(decodeHdr(decodeSrgb(1), 1, 2, 0.5)), 9);
  });

  it("is written in WGSL with the entry points the layer uses", () => {
    expect(PREVIEW_WGSL).toContain("@vertex fn vs(");
    expect(PREVIEW_WGSL).toContain("@fragment fn fs(");
    expect(PREVIEW_WGSL).toContain("exp2(r * params.headroom * params.weight)");
  });
});

describe("detectPreviewSupport", () => {
  it("needs an HDR display, then WebGPU with an adapter", async () => {
    expect(await detectPreviewSupport({ hdrDisplay: () => false, adapter: async () => true })).toBe("no-hdr-display");
    expect(await detectPreviewSupport({ hdrDisplay: () => true, adapter: async () => false })).toBe("no-webgpu");
    expect(await detectPreviewSupport({ hdrDisplay: () => true, adapter: async () => { throw new Error("x"); } })).toBe("no-webgpu");
    expect(await detectPreviewSupport({ hdrDisplay: () => true, adapter: async () => true })).toBe("ok");
  });
});
