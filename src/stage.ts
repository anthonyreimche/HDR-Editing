// The one GPU stage: last of all, after the display transform and every
// display tool, so the gain is measured against the finished SDR pixel.
// `space` gives it the unclipped values on version 2. On version 1 the core
// declares slSceneLuma for it because its GLSL names it.

import { GAIN_GLSL, GAIN_HELPERS } from "./glsl";
import { FIELDS, STAGE_ID } from "./params";
import type { ProcessingStageContribution } from "./safelight";

export function gainStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "HDR",
    phase: "output-encode",
    priority: 1000,
    space: { encoding: "perceptual" },
    glsl: GAIN_GLSL,
    helpers: GAIN_HELPERS,
    uniforms: FIELDS.map((f) => ({
      key: f.key,
      glslType: f.type,
      default: f.def,
      range: { min: f.min, max: f.max, step: f.step },
      label: f.label,
    })),
    presetScope: "global",
  };
}
