// The HDR rendition's luminance in stops relative to SDR white, from a frame
// pair read back small. Bins run from HIST_MIN_STOPS up to the headroom; a
// bin covers (lo, hi], so SDR white (0 stops) closes the last SDR bin.

import { DECODE, type FrameSample } from "./frame";
import { decodeHdr, luma, quantizeHeadroom } from "./model";

export const HIST_MIN_STOPS = -8;
export const BINS_PER_STOP = 4;

export interface HdrHistogram {
  bins: Uint32Array;
  minStops: number;
  maxStops: number;
  /** Index of the first bin above SDR white. */
  firstHdrBin: number;
}

export function hdrHistogram(sdr: FrameSample, gain: FrameSample, headroom: number): HdrHistogram {
  const maxStops = Math.ceil(quantizeHeadroom(headroom));
  const n = (maxStops - HIST_MIN_STOPS) * BINS_PER_STOP;
  const bins = new Uint32Array(n);
  const floor = Math.pow(2, HIST_MIN_STOPS);
  for (let i = 0; i < sdr.width * sdr.height; i++) {
    const o = i * 4;
    const s = luma([DECODE[sdr.data[o]], DECODE[sdr.data[o + 1]], DECODE[sdr.data[o + 2]]]);
    const e = Math.log2(Math.max(decodeHdr(s, gain.data[o] / 255, headroom, 1), floor));
    const bin = Math.ceil((e - HIST_MIN_STOPS) * BINS_PER_STOP - 1e-9) - 1;
    bins[Math.min(n - 1, Math.max(0, bin))]++;
  }
  return { bins, minStops: HIST_MIN_STOPS, maxStops, firstHdrBin: -HIST_MIN_STOPS * BINS_PER_STOP };
}
