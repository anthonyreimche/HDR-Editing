// Visualize HDR: pixels at or below SDR white as a dimmed grey copy, pixels
// above it in one flat colour per stop: (0, 1], (1, 2], (2, 3], (3, 4].

import { DECODE, type FrameSample } from "./frame";
import { decodeHdr, encodeSrgb, luma } from "./model";

export const BAND_COLOURS: readonly (readonly [number, number, number])[] = [
  [63, 167, 255],
  [76, 217, 100],
  [255, 214, 10],
  [255, 55, 95],
];

// Below this many stops a pixel counts as SDR (8-bit noise around white).
const SDR_EPSILON = 0.01;

// The linear channels handed to luma(), reused so a whole frame allocates
// nothing per pixel.
const LINEAR: [number, number, number] = [0, 0, 0];

/** Shades one pixel into out[o..o+2]. visualizePixel and visualizeImage share
 *  it so they cannot drift apart. */
function shade(
  out: Uint8ClampedArray | number[],
  o: number,
  r8: number,
  g8: number,
  b8: number,
  gain8: number,
  headroom: number,
): void {
  LINEAR[0] = DECODE[r8];
  LINEAR[1] = DECODE[g8];
  LINEAR[2] = DECODE[b8];
  const s = luma(LINEAR);
  const e = Math.log2(Math.max(decodeHdr(s, gain8 / 255, headroom, 1), 1e-6));
  if (e <= SDR_EPSILON) {
    // Round to the 8-bit display value before halving: an odd value halves to
    // an exact tie, and encodeSrgb(1) is 1 - 2^-53, which would put white at
    // 127 instead of 128.
    const g = Math.round(Math.round(encodeSrgb(s) * 255) * 0.5);
    out[o] = g;
    out[o + 1] = g;
    out[o + 2] = g;
    return;
  }
  const band = BAND_COLOURS[Math.min(3, Math.ceil(e) - 1)];
  out[o] = band[0];
  out[o + 1] = band[1];
  out[o + 2] = band[2];
}

export function visualizePixel(sdr8: readonly number[], gain8: number, headroom: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  shade(out, 0, sdr8[0], sdr8[1], sdr8[2], gain8, headroom);
  return out;
}

/** The buffer type is spelled out: ImageData only takes an ArrayBuffer-backed array. */
export function visualizeImage(sdr: FrameSample, gain: FrameSample, headroom: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(sdr.width * sdr.height * 4);
  for (let i = 0; i < sdr.width * sdr.height; i++) {
    const o = i * 4;
    shade(out, o, sdr.data[o], sdr.data[o + 1], sdr.data[o + 2], gain.data[o], headroom);
    out[o + 3] = 255;
  }
  return out;
}
