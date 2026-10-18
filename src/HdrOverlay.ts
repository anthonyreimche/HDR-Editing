// The develop-canvas-overlay component. It drives the frame pairs while
// anything needs them (an open HDR panel, the preview, Visualize HDR), for
// a photo with HDR on and current processing, and shows the preview and
// Visualize HDR layers. A view change or a geometry edit hides the layers
// until the pair for it lands (a stale frame would be misplaced). Any other
// edit keeps the last pair up, decoded with the headroom it was captured with,
// until the next one lands. The layers also hide while a core canvas tool that
// draws its own overlay is active, so they never cover its handles, and while
// a core panel is bypassed, which the captures don't see.

import type { ReactElement } from "react";
import { readbackBitmap } from "./frame";
import { createPairScheduler, type FramePair, type PairScheduler } from "./frames";
import { isCurrentProcessing, readParams } from "./params";
import { displayWeight } from "./preview-wgsl";
import { PreviewLayer } from "./PreviewLayer";
import { api, h } from "./runtime";
import { clearStore, store, type Session } from "./store";
import { VisualizeLayer } from "./VisualizeLayer";

export const HISTOGRAM_LONG_EDGE = 256;
export const DISPLAY_HEADROOM_KEY = "displayHeadroom";

// The develop params that move pixels: Straighten, Crop and Transform
// (perspective, aspect, scale, offset and the flips; Upright writes its result
// into straighten and transform). Lens corrections are extension stages.
const GEOMETRY_KEYS = ["straighten", "crop", "transform"] as const;

const byKey = ([a]: [string, unknown], [b]: [string, unknown]): number => (a < b ? -1 : a > b ? 1 : 0);

/** The params that move pixels as one string. Keys are sorted, so the same
 *  geometry rebuilt in another key order reads as unchanged. */
export function geometryOf(params: Record<string, unknown>): string {
  return JSON.stringify(
    GEOMETRY_KEYS.map((key) => params[key]),
    (_key, value: unknown) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(byKey))
        : value,
  );
}

/** Takes over a pair the scheduler publishes: the small readback for the
 *  histogram, then the store, which closes the pair when it is replaced. The
 *  scheduler hands the bitmaps over for good, so nothing here may throw
 *  before the store has them. */
export function publishPair(pair: FramePair | null): void {
  let samples: Session["samples"] = null;
  if (pair) {
    try {
      const sdr = readbackBitmap(pair.sdr, HISTOGRAM_LONG_EDGE);
      const gain = readbackBitmap(pair.gain, HISTOGRAM_LONG_EDGE);
      if (sdr && gain) samples = { sdr, gain };
    } catch (err) {
      // The layers can still use the pair; only the histogram goes without.
      console.warn("[hdr-editing] The histogram frame could not be read back.", err);
    }
  }
  store().getState().setPair(pair, samples);
}

export function HdrOverlay(): ReactElement | null {
  const { useEffect, useRef, useState } = api().react;
  const dev = api().stores.useDevelopStore;
  const photoId = dev((s) => s.photoId);
  const params = dev((s) => s.previewParams ?? s.params);
  // What the canvas draws: a hovered preset's bag while one is previewed.
  const paramBag = dev((s) => s.previewParamBag ?? s.paramBag);
  const busyTool = dev((s) => s.activeTool !== "none" || s.cropping);
  // A bypassed panel drops out of the live render only: the captures render
  // the photo's params in full, so the pair would show what the view doesn't.
  const bypassed = dev((s) => Object.keys(s.bypassedPanels).length > 0);
  const { rect, nonce } = api().develop.useDevelopOverlay();
  const session = store()();
  const scheduler = useRef<PairScheduler | null>(null);
  const [, setSettingsTick] = useState(0);

  const p = readParams(paramBag);
  const eligible = !!photoId && p.on && isCurrentProcessing(params);
  // A preview the display can't show needs no frames.
  const previewOn = session.preview && session.support === "ok";
  const wanted = eligible && (session.panels > 0 || previewOn || session.visualize);

  // The display headroom is read at render, so a change in Preferences would
  // otherwise show only after the next edit.
  useEffect(
    () =>
      api().settings.onChange((key) => {
        if (key === DISPLAY_HEADROOM_KEY) setSettingsTick((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!wanted) return;
    const s = createPairScheduler(
      {
        // Read synchronously: the scheduler reads the basis and starts both
        // captures in one turn so they all see the same edit. The core renders
        // previewParamBag ?? paramBag, so that bag holds the encoding headroom.
        basis: () => {
          const now = dev.getState();
          return {
            headroom: readParams(now.previewParamBag ?? now.paramBag).headroom,
            geometry: geometryOf(now.previewParams ?? now.params),
          };
        },
        capture: (bag) => {
          const now = dev.getState();
          return api().develop.captureFrame(now.previewParams ?? now.params, bag ? { paramBag: bag } : undefined);
        },
      },
      publishPair,
    );
    scheduler.current = s;
    return () => {
      s.stop();
      scheduler.current = null;
      // Also on unmount: a stopped scheduler never replaces the pair, so it
      // would sit in the store, open, until the extension deactivates.
      clearStore();
    };
  }, [wanted]);

  useEffect(() => {
    // The slot renders inside the Develop canvas, whose own effect pushes an
    // edited bag to the render worker. A child's effects run before its
    // parent's, so asking here would capture the previous edit; the microtask
    // runs after the parent's effect, in the same flush. Both captures still
    // start in one turn, inside request(). The end of a bypass asks again: an
    // edit made during it reached the worker with the bypassed bag.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) scheduler.current?.request(nonce);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, photoId, params, paramBag, nonce, bypassed]);

  const pair = session.pair;
  if (!eligible || busyTool || bypassed || !rect || !pair || pair.nonce !== nonce) return null;
  if (pair.geometry !== geometryOf(params)) return null;
  // The pair's own headroom: its gain map holds each lift as a fraction of it.
  const { headroom } = pair;
  const weight = displayWeight(api().settings.get<number>(DISPLAY_HEADROOM_KEY, 2), headroom);
  return h(
    "div",
    { style: { position: "absolute", inset: 0, pointerEvents: "none" } },
    previewOn ? h(PreviewLayer, { key: "preview", pair, headroom, weight, rect }) : null,
    session.visualize ? h(VisualizeLayer, { key: "visualize", pair, headroom, rect }) : null,
  );
}
