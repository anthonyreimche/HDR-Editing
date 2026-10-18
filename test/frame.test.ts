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
