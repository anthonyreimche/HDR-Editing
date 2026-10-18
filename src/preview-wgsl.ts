// The HDR preview's composite: the standard gain-map decode, encoded with the
// extended sRGB curve for an rgba16float canvas in extended tone-mapping
// mode, where 1.0 is SDR white and values above it are brighter. The weight
// scales the lift to the headroom the display has (a setting, since no API
// reports it). previewPixel is its TS twin.

import { DECODE } from "./frame";
import { decodeHdr, encodeSrgbExtended, quantizeHeadroom } from "./model";

export const PREVIEW_WGSL = /* wgsl */ `
struct Params { headroom: f32, weight: f32, offset: f32, pad: f32 };
@group(0) @binding(0) var sdrTex: texture_2d<f32>;
@group(0) @binding(1) var gainTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VOut;
  out.pos = vec4f(p[i], 0.0, 1.0);
  out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return out;
}

fn decode(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));
}

fn encodeExtended(v: vec3f) -> vec3f {
  let a = abs(v);
  let e = select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));
  return sign(v) * e;
}

fn texel(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(t));
  return textureLoad(t, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let sdr = decode(texel(sdrTex, in.uv).rgb);
  let r = texel(gainTex, in.uv).r;
  let hdr = (sdr + params.offset) * exp2(r * params.headroom * params.weight) - params.offset;
  return vec4f(encodeExtended(hdr), 1.0);
}
`;

/** How much of the gain the display can show: its headroom over the photo's. */
export function displayWeight(displayHeadroom: number, headroom: number): number {
  return Math.min(1, Math.max(0, displayHeadroom / quantizeHeadroom(headroom)));
}

export function previewPixel(sdr8: readonly number[], gain8: number, headroom: number, weight: number): [number, number, number] {
  const r = gain8 / 255;
  const ch = (v: number) => encodeSrgbExtended(decodeHdr(DECODE[v], r, headroom, weight));
  return [ch(sdr8[0]), ch(sdr8[1]), ch(sdr8[2])];
}
