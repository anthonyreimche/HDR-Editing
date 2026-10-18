// The gain maths, the TS twin of the stage (glsl.ts mirrors it expression
// for expression). The edit is the SDR rendition; for each pixel the gain is
// how many stops the HDR rendition lifts it: g = headroom · ρ(x) · gate(s),
// with x the scene luminance before the core shoulder (slSceneLuma) and s the
// final SDR pixel's linear luminance. The gain map stores g corrected for
// the Ultra HDR offsets, so a standard decoder reproduces the intended
// luminance: hdr = (sdr + 1/64) · 2^(r · headroom · w) − 1/64.

export const OFFSET = 1 / 64;

export interface GainParams {
  on: boolean;
  /** Stops above SDR white the HDR rendition may reach. */
  headroom: number;
  /** Where expansion begins, in stops relative to SDR white. */
  start: number;
  /** Stops above the start at which ρ reaches 0.80. */
  rolloff: number;
  /** 0…100: how strongly highlights the SDR edit darkened are held back. */
  protection: number;
}

export const luma = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Core srgbToLinear (inputs already in [0, 1]). */
export function decodeSrgb(x: number): number {
  return x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Core linearToSrgb: clamps to [0, 1] first. */
export function encodeSrgb(x: number): number {
  const c = clamp01(x);
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** The sRGB curve on the magnitude, sign kept, no ceiling: how an extended
 *  range canvas reads values past SDR white. */
export function encodeSrgbExtended(x: number): number {
  const a = Math.abs(x);
  const e = a < 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return x < 0 ? -e : e;
}

/** Tenths in [0.5, 4], so the file metadata states it exactly. */
export function quantizeHeadroom(h: number): number {
  return Math.floor(Math.min(4, Math.max(0.5, h)) * 10 + 0.5) / 10;
}

/** GLSL clamp: the stage clamps what the core binds unclamped. */
const clampTo = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 0 at and below the start (zero slope there), 0.80 at `rolloff` stops
 *  above it, toward 1 beyond. Both are held to their slider ranges. */
export function rho(x: number, start: number, rolloff: number): number {
  const k = Math.pow(2, clampTo(start, -3, 0));
  const span = clampTo(rolloff, 0.5, 4);
  const u = (3 * Math.max(Math.log2(Math.max(x, 1e-12) / k), 0)) / span;
  return 1 - (1 + u) * Math.exp(-u);
}

/** Holds back pixels whose SDR luminance the edit kept low. The protection
 *  is held to its slider range. */
export function gate(s: number, protection: number): number {
  const pct = clampTo(protection, 0, 100);
  if (pct <= 0) return 1;
  const p = (0.5 * pct) / 100;
  return smoothstep(0.5 * p, p, s);
}

export function gainStops(s: number, x: number, p: GainParams): number {
  if (!p.on) return 0;
  return quantizeHeadroom(p.headroom) * rho(x, p.start, p.rolloff) * gate(s, p.protection);
}

/** The gain map byte value / 255 for a pixel of SDR luminance s lifted g stops. */
export function encodeGain(s: number, g: number, headroom: number): number {
  const corrected = Math.log2((s * Math.pow(2, g) + OFFSET) / (s + OFFSET));
  return clamp01(corrected / quantizeHeadroom(headroom));
}

/** Linear luminance of a display-encoded SDR pixel, as the stage reads it. */
export function sdrLuminance(c: readonly number[]): number {
  return luma([decodeSrgb(clamp01(c[0])), decodeSrgb(clamp01(c[1])), decodeSrgb(clamp01(c[2]))]);
}

/** The stage in gain-map mode on one pixel. */
export function gainMapValue(c: readonly number[], x: number, p: GainParams): number {
  const s = sdrLuminance(c);
  return encodeGain(s, gainStops(s, x, p), p.headroom);
}

/** A standard gain-map decode of one linear channel; weight 1 is a display
 *  with the full headroom, 0 the SDR rendition. */
export function decodeHdr(sdrLinear: number, r: number, headroom: number, weight: number): number {
  return (sdrLinear + OFFSET) * Math.pow(2, r * quantizeHeadroom(headroom) * weight) - OFFSET;
}
