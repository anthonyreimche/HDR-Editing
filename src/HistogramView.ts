// The HDR histogram: stops from -8 up to the headroom, the SDR range in the
// muted text colour, the range above SDR white in the accent colour, a line
// at SDR white. Its own file name: histogram.ts holds the maths, and the two
// names must not differ only by case (Windows and macOS treat them as one).

import type { ReactElement } from "react";
import { hdrHistogram } from "./histogram";
import { api, h } from "./runtime";
import { store } from "./store";

const HEIGHT = 56;

export function HistogramView(): ReactElement {
  const { useMemo } = api().react;
  const samples = store()((s) => s.samples);
  // The headroom the pair's gain map was encoded with (a hovered preset's,
  // when it was captured during the hover), not the slider's as it moves.
  const headroom = store()((s) => s.pair?.headroom);
  const { tokens } = api().ui;
  // The panel re-renders on every slider tick; the frames only change when a
  // new pair lands.
  const hist = useMemo(
    () => (samples && headroom !== undefined ? hdrHistogram(samples.sdr, samples.gain, headroom) : null),
    [samples, headroom],
  );
  if (!hist) {
    return h("div", { style: { height: HEIGHT, fontSize: 11, color: tokens.textMuted, display: "flex", alignItems: "center", justifyContent: "center" } }, "No frame");
  }
  const peak = Math.max(1, ...hist.bins);
  const n = hist.bins.length;
  const bars = Array.from(hist.bins, (count, i) =>
    h("rect", {
      key: i,
      x: i,
      width: 0.9,
      y: HEIGHT - (HEIGHT * Math.sqrt(count)) / Math.sqrt(peak),
      height: (HEIGHT * Math.sqrt(count)) / Math.sqrt(peak),
      fill: i < hist.firstHdrBin ? tokens.textMuted : tokens.accent,
    }),
  );
  return h(
    "svg",
    { viewBox: `0 0 ${n} ${HEIGHT}`, preserveAspectRatio: "none", style: { width: "100%", height: HEIGHT, display: "block" } },
    ...bars,
    h("line", { key: "white", x1: hist.firstHdrBin, x2: hist.firstHdrBin, y1: 0, y2: HEIGHT, stroke: tokens.textSecondary, strokeWidth: 0.4 }),
  );
}
