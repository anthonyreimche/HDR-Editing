import { describe, expect, it } from "vitest";
import { DEFAULTS, FIELDS, GAIN_MAP_PATCH, KEY, STAGE_ID, isCurrentProcessing, paramsPatch, readParams, resetPatch } from "../src/params";

describe("params", () => {
  it("default to the spec's values", () => {
    expect(DEFAULTS).toEqual({ on: false, headroom: 2, start: -0.25, rolloff: 1.5, protection: 50 });
  });

  it("qualify every key under the stage", () => {
    expect(FIELDS.map((f) => f.key)).toEqual(["on", "headroom", "start", "rolloff", "protection", "mode"]);
    expect(KEY.mode).toBe(`${STAGE_ID}.mode`);
    expect(GAIN_MAP_PATCH).toEqual({ [`${STAGE_ID}.mode`]: 1 });
  });

  it("clamp, quantise the headroom, and fall back on junk", () => {
    const p = readParams({ [KEY.headroom]: 2.34, [KEY.start]: -9, [KEY.rolloff]: "x", [KEY.on]: 1 });
    expect(p).toEqual({ on: true, headroom: 2.3, start: -3, rolloff: 1.5, protection: 50 });
  });

  it("round-trip and never write the mode", () => {
    const p = { on: true, headroom: 3.5, start: -1, rolloff: 2, protection: 0 };
    const patch = paramsPatch(p);
    expect(readParams(patch)).toEqual(p);
    expect(KEY.mode in patch).toBe(false);
    expect(KEY.mode in resetPatch()).toBe(false);
  });

  it("knows current processing from the params' process version", () => {
    expect(isCurrentProcessing({ processVersion: 2 })).toBe(true);
    expect(isCurrentProcessing({ processVersion: 1 })).toBe(false);
    expect(isCurrentProcessing({})).toBe(false);
    expect(isCurrentProcessing(null)).toBe(false);
  });
});
