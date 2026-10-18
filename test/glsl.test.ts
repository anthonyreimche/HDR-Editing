import { describe, expect, it } from "vitest";
import { GAIN_GLSL, GAIN_HELPERS } from "../src/glsl";
import { FIELDS, STAGE_ID, type GainKey } from "../src/params";
import { gainStage } from "../src/stage";
import { inlineFetches } from "./support/fetch-budget";

const KEYS = new Set<string>(FIELDS.map((f) => f.key));

function declared(src: string): string[] {
  const names: string[] = [];
  const decl = /\b(?:float|int|bool|vec[234])\s+(\w+)\s*(?:=|;|,|\))/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src))) names.push(m[1]);
  return names;
}

describe("gain stage GLSL", () => {
  it("has no directives or backticks and reads no textures", () => {
    for (const src of [GAIN_GLSL, GAIN_HELPERS]) {
      expect(src).not.toMatch(/#/);
      expect(src).not.toMatch(/`/);
    }
    expect(inlineFetches(GAIN_GLSL, GAIN_HELPERS)).toBe(0);
  });

  it("names no parameter or local like a uniform key", () => {
    for (const id of declared(GAIN_GLSL + GAIN_HELPERS)) expect(KEYS.has(id), id).toBe(false);
  });

  it("uses every uniform and reads the core's scene luminance", () => {
    for (const k of KEYS) expect(GAIN_GLSL).toMatch(new RegExp(`\\b${k}\\b`));
    expect(GAIN_GLSL).toMatch(/\bslSceneLuma\b/);
  });

  it("writes the Ultra HDR offset as a float literal", () => {
    expect(GAIN_HELPERS).toContain("0.015625");
  });

  it("clamps the start, roll-off and protection to their fields' ranges before using them, as readParams does", () => {
    // The core binds bag values as stored, so a hand-edited preset could hand
    // the stage a roll-off of 0 (a division by zero) or values past a slider.
    const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    const clampOf = (arg: string, key: GainKey) => {
      const f = FIELDS.find((x) => x.key === key)!;
      return `clamp(${arg}, ${glslFloat(f.min)}, ${glslFloat(f.max)})`;
    };
    for (const [arg, key] of [["startEv", "start"], ["rolloffEv", "rolloff"], ["protectionPct", "protection"]] as const) {
      expect(GAIN_HELPERS).toContain(clampOf(arg, key));
      // Named once as the parameter and once inside the clamp, nowhere raw.
      expect(GAIN_HELPERS.match(new RegExp(`\\b${arg}\\b`, "g"))).toHaveLength(2);
    }
  });

  it("quantises the headroom to tenths in the GLSL, as the file metadata does", () => {
    // Pinned on the text: the GPU spec checks the values (2.34 → 2.3).
    expect(GAIN_HELPERS).toMatch(/float hdHeadroom\(float h\)/);
    expect(GAIN_HELPERS).toContain("clamp(h, 0.5, 4.0) * 10.0 + 0.5");
    expect(GAIN_GLSL).toMatch(/hdHeadroom\(headroom\)/);
  });
});

describe("gainStage", () => {
  it("runs last, after the transform, on unclamped values, with the fields as uniforms", () => {
    const s = gainStage();
    expect(s).toMatchObject({
      id: STAGE_ID,
      phase: "output-encode",
      priority: 1000,
      space: { encoding: "perceptual" },
      presetScope: "global",
    });
    expect(s.uniforms.map((u) => u.key)).toEqual(FIELDS.map((f) => f.key));
    expect(s.uniforms.find((u) => u.key === "mode")).toMatchObject({ glslType: "int", default: 0 });
  });
});
