// The gain stage on the real renderer (needs the core with slSceneLuma).
// Run via `npm run test:gpu`. Checks: compiles for both process versions
// (version 2 declares slSceneLuma in main(), version 1 through the
// injector); a normal render and HDR off are bit-exact against no stage; the
// gain map matches the TS twin on a ramp that reaches far past the core
// shoulder; the headroom is quantised to tenths on the GPU as it is in the
// file metadata.

import { describe, expect, it } from "vitest";
import { CURRENT_PROCESS_VERSION, LEGACY_PROCESS_VERSION } from "@/catalog/types";
import {
  LINEAR_PROBE_PIPELINE,
  floatImage,
  identityParams,
  rendererBuildError,
  withRenderer,
  type Frame,
} from "@/rendering/webgl/webgl.test-support";
import { OFFSET, clamp01, gainMapValue, gate, luma, rho, sdrLuminance, type GainParams } from "@hdr/model";
import { DEFAULTS, GAIN_MAP_PATCH, paramsPatch } from "@hdr/params";
import type { ProcessingStageContribution } from "@hdr/safelight";
import { gainStage } from "@hdr/stage";

const W = 128;
const H = 16;
const V1 = { processVersion: LEGACY_PROCESS_VERSION };
const V2 = { processVersion: CURRENT_PROCESS_VERSION };
const TOLERANCE = 2e-3;

/** float32 → binary16 → float32, nearest even: what the RGBA16F upload holds. */
function f16round(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  const step = Math.pow(2, Math.max(e, -14) - 10);
  const q = a / step;
  const f = Math.floor(q);
  const frac = q - f;
  const r = frac > 0.5 || (frac === 0.5 && f % 2 === 1) ? f + 1 : f;
  return sign * r * step;
}

const ramp = (x: number) => 0.02 * Math.pow(400, x / (W - 1)); // 0.02 … 8
const texel = (x: number, y: number): [number, number, number] => {
  const v = ramp(x);
  return y < H / 2 ? [v, v, v] : [v, v * 0.7, v * 0.45];
};
const SCENE = floatImage(W, H, texel);
/** The scene luminance the stage reads on version 2 (exposure 0). */
const sceneLuma = (x: number, y: number) => luma(texel(x, y).map((v) => f16round(Math.fround(v))));

/** Before its tone block the core rebuilds a linear source pixel with one or two
 *  channels at or past its sensor-white threshold (uClipThreshold, 0.98) from
 *  the neighbours, so such a pixel's slSceneLuma is not its texel's luminance.
 *  On the tinted rows the channels cross 0.98 at different columns, which
 *  leaves a band of columns in that state; the twin has no scene value there. */
const rebuiltByCore = (x: number, y: number): boolean => {
  const clipped = texel(x, y).filter((v) => f16round(Math.fround(v)) >= Math.fround(0.98)).length;
  return clipped === 1 || clipped === 2;
};

function frames(stages: ProcessingStageContribution[], bags: Record<string, unknown>[], over: Record<string, unknown>): Frame[] {
  return withRenderer({ stages, pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
    r.setImage(SCENE);
    r.setParams(identityParams(over));
    return bags.map((bag) => {
      r.setContributedParams(bag);
      const f = r.captureFloatFrame();
      if (!f) throw new Error("captureFloatFrame returned null");
      return f;
    });
  });
}

function expectBitExact(a: Frame, b: Frame): void {
  let differing = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) differing++;
  expect(differing).toBe(0);
}

const on = (over: Partial<GainParams>): GainParams => ({ ...DEFAULTS, on: true, ...over });
const CASES: [string, GainParams][] = [
  ["defaults", on({})],
  ["headroom 4, early start, long roll-off", on({ headroom: 4, start: -1.5, rolloff: 3 })],
  ["no protection", on({ protection: 0 })],
  ["full protection, late start", on({ protection: 100, start: 0 })],
  // paramsPatch stores the headroom as typed; the stage rounds it to 2.3.
  ["headroom 2.34, not a tenth", on({ headroom: 2.34 })],
  // The core binds the bag unclamped; the stage holds each to its range.
  ["out of range: start -5, roll-off 0.25, protection 150", on({ start: -5, rolloff: 0.25, protection: 150 })],
];

describe("HDR gain stage on the real renderer", () => {
  it("compiles for both process versions", () => {
    expect(rendererBuildError({ stages: [gainStage()], pipeline: LINEAR_PROBE_PIPELINE })).toBeNull();
  });

  it("changes nothing in a normal render, HDR on or off", () => {
    for (const over of [V1, V2]) {
      const [bare] = frames([], [{}], over);
      const [idle, hdr] = frames([gainStage()], [{}, paramsPatch(on({ headroom: 4 }))], over);
      expectBitExact(idle, bare);
      expectBitExact(hdr, bare);
    }
  });

  it("outputs an empty gain map with HDR off", () => {
    const [map] = frames([gainStage()], [{ ...paramsPatch(DEFAULTS), ...GAIN_MAP_PATCH }], V2);
    for (let i = 0; i < map.data.length; i += 4) expect(map.data[i]).toBe(0);
  });

  for (const [version, over] of [["v1", V1], ["v2", V2]] as const) {
    it(`outputs the TS twin's gain map (${version})`, () => {
      const [off, ...maps] = frames(
        [gainStage()],
        [{}, ...CASES.map(([, p]) => ({ ...paramsPatch(p), ...GAIN_MAP_PATCH }))],
        over,
      );
      CASES.forEach(([name, p], i) => {
        let worst = 0;
        let where = "";
        let peak = 0;
        let skipped = 0;
        // Version 1 hands the stage luma(lin) after the shoulder, which the
        // probe pipeline writes straight out, but only the grey rows survive
        // the output clip unchanged (a bright tinted pixel's red passes 1).
        const rows = version === "v2" ? H : H / 2;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < W; x++) {
            if (version === "v2" && rebuiltByCore(x, y)) {
              skipped++;
              continue;
            }
            const o = (y * W + x) * 4;
            const c = [off.data[o], off.data[o + 1], off.data[o + 2]];
            const scene = version === "v2" ? sceneLuma(x, y) : luma(c);
            const want = gainMapValue(c, scene, p);
            const got = maps[i].data[o];
            peak = Math.max(peak, got);
            if (Math.abs(got - want) > worst) {
              worst = Math.abs(got - want);
              where = `x=${x} y=${y} scene=${scene.toFixed(3)} want=${want.toFixed(4)} got=${got.toFixed(4)}`;
            }
          }
        }
        console.log(`[hdr-gpu] ${version} ${name}: worst ${worst.toExponential(2)}, peak ${peak.toFixed(3)}, skipped ${skipped}; ${where}`);
        expect(worst).toBeLessThan(TOLERANCE);
        expect(skipped).toBeLessThan((W * H) / 10);
        if (version === "v2") expect(peak).toBeGreaterThan(0.5);
      });
    });
  }
});

// The encoded map barely moves with the headroom (the decode multiplies it
// back out), so against the twin the rounding to tenths hides inside the
// tolerance. Frames at headrooms that round alike must instead be identical,
// and the case only means something where the unrounded value would have
// drawn a different frame: pixels the SDR edit left dark under a high scene
// luminance, where the offsets weigh most.
describe("HDR gain stage headroom quantisation", () => {
  // Stands in for an SDR edit that pulled the highlights down; its `c *= 0.2`
  // runs before the gain stage, which takes the scene luminance from the core.
  const DARKEN: ProcessingStageContribution = {
    id: "test.darken",
    name: "Darken",
    phase: "display-adjust",
    glsl: "c *= 0.2;",
    uniforms: [],
  };
  const map = (headroom: number) => ({ ...paramsPatch(on({ headroom, protection: 0 })), ...GAIN_MAP_PATCH });
  const GROUPS: [number, number[]][] = [
    [2.3, [2.34, 2.26]],
    [0.7, [0.74, 0.66]],
  ];

  /** Pixels whose half-float gain-map value would change if the headroom were used as typed. */
  function pixelsSensitiveTo(typed: number, rounded: number, dark: Frame): number {
    const value = (headroom: number, s: number, scene: number) => {
      const g = headroom * rho(scene, DEFAULTS.start, DEFAULTS.rolloff) * gate(s, 0);
      return f16round(clamp01(Math.log2((s * Math.pow(2, g) + OFFSET) / (s + OFFSET)) / headroom));
    };
    let count = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (rebuiltByCore(x, y)) continue;
        const o = (y * W + x) * 4;
        const s = sdrLuminance([dark.data[o], dark.data[o + 1], dark.data[o + 2]]);
        const scene = sceneLuma(x, y);
        if (value(typed, s, scene) !== value(rounded, s, scene)) count++;
      }
    }
    return count;
  }

  for (const [rounded, typed] of GROUPS) {
    it(`draws the same gain map for headrooms that round to ${rounded}`, () => {
      const [dark] = frames([DARKEN], [{}], V2);
      const [exact, ...others] = frames([DARKEN, gainStage()], [map(rounded), ...typed.map(map)], V2);
      typed.forEach((t, i) => {
        expect(pixelsSensitiveTo(t, rounded, dark), `headroom ${t} is a different frame unrounded`).toBeGreaterThan(50);
        expectBitExact(exact, others[i]);
      });
    });
  }
});
