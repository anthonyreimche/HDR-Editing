// An 8-bit readback of a captured frame.

import { decodeSrgb } from "./model";

export interface FrameSample {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const DECODE = Float64Array.from({ length: 256 }, (_, i) => decodeSrgb(i / 255));

let scratch: OffscreenCanvas | null = null;

/** A bitmap drawn at ≤ longEdge and read back; null for the host's 1×1
 *  "no renderer" blank. */
export function readbackBitmap(bitmap: ImageBitmap, longEdge: number): FrameSample | null {
  const { width: bw, height: bh } = bitmap;
  if (bw < 2 || bh < 2) return null;
  const scale = Math.min(1, longEdge / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * scale));
  const h = Math.max(1, Math.round(bh * scale));
  if (!scratch) scratch = new OffscreenCanvas(w, h);
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // The scratch canvas is reused: "copy" replaces what a frame with alpha
  // would otherwise blend over, which is the previous readback.
  ctx.globalCompositeOperation = "copy";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}
