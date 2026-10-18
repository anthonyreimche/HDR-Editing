// Visualize HDR over the Develop canvas: the pair read back at ≤ 1024 px,
// mapped by visualizeImage, drawn without smoothing.

import type { CSSProperties, ReactElement } from "react";
import { readbackBitmap } from "./frame";
import type { FramePair } from "./frames";
import { api, h } from "./runtime";
import type { OverlayRect } from "./safelight";
import { visualizeImage } from "./visualize";

export const VISUALIZE_LONG_EDGE = 1024;

export function VisualizeLayer(props: { pair: FramePair; headroom: number; rect: OverlayRect }): ReactElement {
  const { useEffect, useRef } = api().react;
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    // A closed bitmap reads back as null, so a superseded pair draws nothing.
    const sdr = readbackBitmap(props.pair.sdr, VISUALIZE_LONG_EDGE);
    const gain = readbackBitmap(props.pair.gain, VISUALIZE_LONG_EDGE);
    if (!el || !sdr || !gain) return;
    el.width = sdr.width;
    el.height = sdr.height;
    el.getContext("2d")?.putImageData(new ImageData(visualizeImage(sdr, gain, props.headroom), sdr.width, sdr.height), 0, 0);
  }, [props.pair, props.headroom]);

  const style: CSSProperties = {
    position: "absolute",
    left: `${props.rect.x}px`,
    top: `${props.rect.y}px`,
    width: `${props.rect.w}px`,
    height: `${props.rect.h}px`,
    imageRendering: "pixelated",
    pointerEvents: "none",
  };
  return h("canvas", { ref: canvas, style });
}
