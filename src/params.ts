// The stage's params in the per-photo paramBag. `mode` is never part of an
// edit: captures and export renders pass GAIN_MAP_PATCH to get the gain map.

import { quantizeHeadroom, type GainParams } from "./model";

export const EXT_ID = "hdr-editing";
export const STAGE_ID = `${EXT_ID}.gain`;
export const PANEL_ID = `${EXT_ID}.panel`;
export const OVERLAY_ID = `${EXT_ID}.overlay`;
export const PROCESSOR_ID = `${EXT_ID}.export`;

export type GainKey = "on" | "headroom" | "start" | "rolloff" | "protection" | "mode";

export interface FieldSpec {
  key: GainKey;
  type: "float" | "int";
  def: number;
  min: number;
  max: number;
  step: number;
  label: string;
}

export const FIELDS: readonly FieldSpec[] = [
  { key: "on", type: "float", def: 0, min: 0, max: 1, step: 1, label: "HDR" },
  { key: "headroom", type: "float", def: 2, min: 0.5, max: 4, step: 0.1, label: "Headroom" },
  { key: "start", type: "float", def: -0.25, min: -3, max: 0, step: 0.05, label: "Start" },
  { key: "rolloff", type: "float", def: 1.5, min: 0.5, max: 4, step: 0.1, label: "Roll-off" },
  { key: "protection", type: "float", def: 50, min: 0, max: 100, step: 1, label: "Highlight protection" },
  { key: "mode", type: "int", def: 0, min: 0, max: 1, step: 1, label: "Output" },
];

export const KEY = Object.fromEntries(FIELDS.map((f) => [f.key, `${STAGE_ID}.${f.key}`])) as Record<GainKey, string>;

/** Merged over a capture's or export render's bag: the stage outputs the gain map. */
export const GAIN_MAP_PATCH: Readonly<Record<string, number>> = { [KEY.mode]: 1 };

const field = (key: GainKey): FieldSpec => FIELDS.find((f) => f.key === key)!;

function value(bag: Record<string, unknown>, key: GainKey): number {
  const f = field(key);
  const v = bag[KEY[key]];
  if (typeof v !== "number" || !Number.isFinite(v)) return f.def;
  return Math.min(f.max, Math.max(f.min, v));
}

export function readParams(bag: Record<string, unknown>): GainParams {
  return {
    on: value(bag, "on") > 0.5,
    headroom: quantizeHeadroom(value(bag, "headroom")),
    start: value(bag, "start"),
    rolloff: value(bag, "rolloff"),
    protection: value(bag, "protection"),
  };
}

export const DEFAULTS: GainParams = readParams({});

export function paramsPatch(next: Partial<GainParams>): Record<string, number> {
  const out: Record<string, number> = {};
  if (next.on !== undefined) out[KEY.on] = next.on ? 1 : 0;
  if (next.headroom !== undefined) out[KEY.headroom] = next.headroom;
  if (next.start !== undefined) out[KEY.start] = next.start;
  if (next.rolloff !== undefined) out[KEY.rolloff] = next.rolloff;
  if (next.protection !== undefined) out[KEY.protection] = next.protection;
  return out;
}

export function resetPatch(): Record<string, number> {
  return paramsPatch(DEFAULTS);
}

/** Only version 2 photos carry the scene's headroom (slSceneLuma). */
export function isCurrentProcessing(params: unknown): boolean {
  if (typeof params !== "object" || params === null) return false;
  const v = (params as { processVersion?: unknown }).processVersion;
  return typeof v === "number" && v >= 2;
}
