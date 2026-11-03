import { afterEach, describe, expect, it, vi } from "vitest";
import { DECODE } from "../src/frame";
import { decodeSrgb } from "../src/model";

const bitmap = (width: number, height: number) => ({ width, height }) as unknown as ImageBitmap;

/** A fresh frame module over a canvas that records what the readback asked
 *  of it (the module keeps its scratch canvas, so each case starts clean). */
async function withCanvas(hasContext = true) {
  const drawImage = vi.fn();
  const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
  }));
  const ctx = { drawImage, getImageData, globalCompositeOperation: "source-over", imageSmoothingQuality: "low" };
  class FakeCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return hasContext ? ctx : null;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.resetModules();
  const { readbackBitmap } = await import("../src/frame");
  return { readbackBitmap, drawImage, getImageData, ctx };
}

afterEach(() => vi.unstubAllGlobals());

describe("DECODE", () => {
  it("is the sRGB curve over every byte", () => {
    expect(DECODE).toHaveLength(256);
    expect(DECODE[0]).toBe(0);
    expect(DECODE[255]).toBe(1);
    for (const i of [1, 10, 118, 200]) expect(DECODE[i]).toBe(decodeSrgb(i / 255));
  });
});

describe("readbackBitmap", () => {
  it("returns null for the host's 1x1 blank, without touching a canvas", async () => {
    const { readbackBitmap, getImageData } = await withCanvas();
    expect(readbackBitmap(bitmap(1, 1), 256)).toBeNull();
    expect(readbackBitmap(bitmap(1, 400), 256)).toBeNull();
    expect(getImageData).not.toHaveBeenCalled();
  });

  it("draws a large bitmap down to the long edge, keeping the aspect", async () => {
    const { readbackBitmap, drawImage } = await withCanvas();
    const sample = readbackBitmap(bitmap(4000, 3000), 400);
    expect(sample).toMatchObject({ width: 400, height: 300 });
    expect(sample!.data).toHaveLength(400 * 300 * 4);
    expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 400, 300);
  });

  it("replaces the previous frame instead of blending over it, and downscales smoothly", async () => {
    const { readbackBitmap, ctx } = await withCanvas();
    readbackBitmap(bitmap(4000, 3000), 400);
    // A frame with alpha must not show the last readback through.
    expect(ctx.globalCompositeOperation).toBe("copy");
    expect(ctx.imageSmoothingQuality).toBe("high");
  });

  it("never scales a small bitmap up", async () => {
    const { readbackBitmap } = await withCanvas();
    expect(readbackBitmap(bitmap(64, 32), 400)).toMatchObject({ width: 64, height: 32 });
  });

  it("returns null when no 2d context is available", async () => {
    const { readbackBitmap } = await withCanvas(false);
    expect(readbackBitmap(bitmap(64, 32), 400)).toBeNull();
  });
});

describe("resizeFrame", () => {
  const ramp = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) data.set([Math.round((255 * x) / (w - 1)), 40, 90, 255], (y * w + x) * 4);
    }
    return { data, width: w, height: h };
  };

  it("hands back the frame it was given when it is already that size", async () => {
    const { resizeFrame } = await import("../src/frame");
    const f = ramp(8, 4);
    expect(resizeFrame(f, 8, 4)).toBe(f);
  });

  it("keeps a flat frame flat at any size", async () => {
    const { resizeFrame } = await import("../src/frame");
    const flat = { data: new Uint8ClampedArray(5 * 3 * 4).fill(77), width: 5, height: 3 };
    const out = resizeFrame(flat, 11, 7);
    expect([out.width, out.height, out.data.length]).toEqual([11, 7, 11 * 7 * 4]);
    expect(new Set(out.data)).toEqual(new Set([77]));
  });

  it("scales a ramp up smoothly, keeping both ends", async () => {
    const { resizeFrame } = await import("../src/frame");
    const out = resizeFrame(ramp(4, 2), 16, 4);
    const row = Array.from({ length: 16 }, (_, x) => out.data[x * 4]);
    expect(row[0]).toBe(0);
    expect(row[15]).toBe(255);
    for (let x = 1; x < 16; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(out.data[1]).toBe(40);
    expect(out.data[3]).toBe(255);
  });

  it("scales a frame down by sampling at the new pixels' centres", async () => {
    const { resizeFrame } = await import("../src/frame");
    const out = resizeFrame(ramp(16, 4), 4, 2);
    expect([out.width, out.height]).toEqual([4, 2]);
    // New pixel 0 is centred between source columns 1 and 2: 1.5 / 15 of the ramp.
    expect(Math.abs(out.data[0] - (255 * 1.5) / 15)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.data[3 * 4] - (255 * 13.5) / 15)).toBeLessThanOrEqual(1);
  });
});
