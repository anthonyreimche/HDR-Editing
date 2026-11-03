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

/** A frame bilinearly resampled to `width` × `height`, sample centres mapped to
 *  sample centres. For a smooth map, such as a gain map a pixel or a scale
 *  factor away from its image; not for detail, which a down-scale would alias. */
export function resizeFrame(frame: FrameSample, width: number, height: number): FrameSample {
  if (frame.width === width && frame.height === height) return frame;
  const data = new Uint8ClampedArray(width * height * 4);
  const sx = frame.width / width;
  const sy = frame.height / height;
  const at = (x: number, y: number, c: number) => frame.data[(y * frame.width + x) * 4 + c];
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), frame.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, frame.height - 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), frame.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, frame.width - 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - tx) + at(x1, y0, c) * tx;
        const bottom = at(x0, y1, c) * (1 - tx) + at(x1, y1, c) * tx;
        data[(y * width + x) * 4 + c] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return { data, width, height };
}
