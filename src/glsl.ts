// The gain stage's GLSL: model.ts, expression for expression. Uniform keys
// are written bare (the host rewrites them by whole word); slSceneLuma is the
// core's scene luminance before its default shoulder (contributions.md). The
// core binds the bag as stored, so the helpers hold the start, roll-off and
// protection to their FIELDS ranges, as readParams does. In a normal render
// the stage does nothing; with mode 1 it outputs the encoded gain map as grey,
// which the core's output encode leaves as it is for sRGB output, the colour
// space every gain-map render asks for.

import { OFFSET } from "./model";

const offset = String(OFFSET); // "0.015625"

export const GAIN_HELPERS = `float hdRho(float x, float startEv, float rolloffEv) {
  float k = exp2(clamp(startEv, -3.0, 0.0));
  float span = clamp(rolloffEv, 0.5, 4.0);
  float u = 3.0 * max(log2(max(x, 1e-12) / k), 0.0) / span;
  return 1.0 - (1.0 + u) * exp(-u);
}

float hdGate(float s, float protectionPct) {
  float pct = clamp(protectionPct, 0.0, 100.0);
  if (pct <= 0.0) return 1.0;
  float p = 0.5 * pct / 100.0;
  return smoothstep(0.5 * p, p, s);
}

float hdHeadroom(float h) {
  return floor(clamp(h, 0.5, 4.0) * 10.0 + 0.5) / 10.0;
}

float hdEncode(float s, float g, float headroomEv) {
  float corrected = log2((s * exp2(g) + ${offset}) / (s + ${offset}));
  return clamp(corrected / headroomEv, 0.0, 1.0);
}`;

export const GAIN_GLSL = `if (mode == 1) {
  float hdS = luma(srgbToLinear(clamp(c, 0.0, 1.0)));
  float hdH = hdHeadroom(headroom);
  float hdG = on > 0.5 ? hdH * hdRho(slSceneLuma, start, rolloff) * hdGate(hdS, protection) : 0.0;
  c = vec3(hdEncode(hdS, hdG, hdH));
}`;
