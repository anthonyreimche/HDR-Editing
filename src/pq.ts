// HDR AVIF pixels: the HDR rendition rebuilt from the SDR frame and the gain
// map (the same decode every Ultra HDR reader does, full weight), moved to
// Rec.2020 primaries (BT.2087), SDR white placed at 203 cd/m² (ITU-R
// BT.2408), and PQ-encoded (SMPTE ST 2084) to 10-bit codes.

import { DECODE, type FrameSample } from "./frame";
import { OFFSET, quantizeHeadroom } from "./model";

export const REFERENCE_WHITE = 203;

const M1 = 2610 / 16384;
const M2 = (2523 / 4096) * 128;
const C1 = 3424 / 4096;
const C2 = (2413 / 4096) * 32;
const C3 = (2392 / 4096) * 32;

/** ST 2084 inverse EOTF: luminance / 10000 cd/m² → signal 0…1. */
export function pqEncode(y: number): number {
  const v = Math.pow(Math.min(1, Math.max(0, y)), M1);
  return Math.pow((C1 + C2 * v) / (1 + C3 * v), M2);
}

/** BT.2087 linear Rec.709 → linear Rec.2020, row-major. */
export const REC709_TO_REC2020 = [
  0.627404, 0.329283, 0.043313, 0.069097, 0.91954, 0.011362, 0.016391, 0.088013, 0.895595,
] as const;

/** The gain map is read by pixel index; another size would pair pixels with
 *  the wrong gain, or none, without failing. */
export function checkGainMapSize(sdr: FrameSample, gain: FrameSample): void {
  if (gain.width !== sdr.width || gain.height !== sdr.height) {
    throw new Error(`[hdr-editing] the gain map is ${gain.width}x${gain.height}, the image ${sdr.width}x${sdr.height}`);
  }
}

/** Where each 10-bit code begins: code k is what Math.round(pqEncode(y) *
 *  1023) gives for y in [edge k, edge k + 1). Found by bisection against
 *  pqEncode itself, so looking a value up gives the formula's code, without its
 *  two pows. Built on first use; edge 0 is -Infinity. */
let edges: Float64Array | null = null;

function pqEdges(): Float64Array {
  if (edges) return edges;
  const code = (y: number) => Math.round(pqEncode(y) * 1023);
  const e = new Float64Array(1024);
  e[0] = Number.NEGATIVE_INFINITY;
  let below = 0;
  for (let k = 1; k < 1024; k++) {
    // code(below) < k <= code(above), narrowed to neighbouring doubles.
    let above = 1;
    for (;;) {
      const mid = below + (above - below) / 2;
      if (mid === below || mid === above) break;
      if (code(mid) >= k) above = mid;
      else below = mid;
    }
    e[k] = above;
  }
  edges = e;
  return e;
}

/** Linear Rec.2020 light (SDR white 1) → its 10-bit PQ code. */
function pq10(linear: number, e: Float64Array): number {
  const y = (Math.max(linear, 0) * REFERENCE_WHITE) / 10000;
  let lo = 0;
  let hi = 1024;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (y >= e[mid]) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** RGBA, 10-bit codes in a buffer of its own (jSquash hands the whole buffer
 *  to the encoder, so a view would leak neighbouring bytes). */
export function hdrToPq10(sdr: FrameSample, gain: FrameSample, headroom: number): Uint16Array {
  checkGainMapSize(sdr, gain);
  const h = quantizeHeadroom(headroom);
  // The gain map holds 8-bit codes, so its lifts are 256 numbers.
  const lift = Float64Array.from({ length: 256 }, (_, v) => Math.pow(2, (v / 255) * h));
  const e = pqEdges();
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = REC709_TO_REC2020;
  const px = sdr.data;
  const n = sdr.width * sdr.height;
  const out = new Uint16Array(n * 4);
  for (let o = 0; o < n * 4; o += 4) {
    const g = lift[gain.data[o]];
    const r = (DECODE[px[o]] + OFFSET) * g - OFFSET;
    const gr = (DECODE[px[o + 1]] + OFFSET) * g - OFFSET;
    const b = (DECODE[px[o + 2]] + OFFSET) * g - OFFSET;
    out[o] = pq10(m0 * r + m1 * gr + m2 * b, e);
    out[o + 1] = pq10(m3 * r + m4 * gr + m5 * b, e);
    out[o + 2] = pq10(m6 * r + m7 * gr + m8 * b, e);
    out[o + 3] = 1023;
  }
  return out;
}
