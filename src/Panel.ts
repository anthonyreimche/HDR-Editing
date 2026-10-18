// The Develop panel "HDR": the per-photo switch, the HDR histogram, the
// rendition sliders, and the two view toggles. On an older-processing photo
// the controls are replaced by the reason and the core's fix.

import type { CSSProperties, ReactElement } from "react";
import { HistogramView } from "./HistogramView";
import { DEFAULTS, isCurrentProcessing, KEY, paramsPatch, readParams } from "./params";
import { SUPPORT_TEXT } from "./preview-support";
import { api, h } from "./runtime";
import { store } from "./store";

const PAD: CSSProperties = { padding: "6px 8px 8px" };

type SliderKey = "headroom" | "start" | "rolloff" | "protection";

export function HdrPanel(): ReactElement {
  const { useEffect } = api().react;
  const { Slider } = api().components;
  const { Toggle, Section, Stack, tokens } = api().ui;
  const dev = api().stores.useDevelopStore;
  const paramBag = dev((s) => s.paramBag);
  const params = dev((s) => s.params);
  const photoId = dev((s) => s.photoId);
  const session = store()();
  const p = readParams(paramBag);
  const hint: CSSProperties = { margin: 0, fontSize: 10, lineHeight: 1.4, color: tokens.textMuted };

  useEffect(() => store().getState().panelMounted(), []);

  const write = (patch: Record<string, number>) => dev.getState().setDynParams(patch);
  const commit = (what: string) => void dev.getState().commitEdit(`HDR ${what}`);

  if (!photoId) return h("div", { style: PAD }, h("p", { style: hint }, "Open a photo to edit its HDR."));
  if (!isCurrentProcessing(params)) {
    return h(
      "div",
      { style: PAD },
      h("p", { style: hint }, "HDR needs the current processing. Use Update processing in the Develop status bar."),
    );
  }

  const slider = (label: string, key: SliderKey, min: number, max: number, step: number) =>
    h(Slider, {
      key,
      label,
      value: p[key],
      min,
      max,
      step,
      defaultValue: DEFAULTS[key],
      onChange: (v: number) => write({ [KEY[key]]: v }),
      onCommit: () => commit(label.toLowerCase()),
    });

  const previewReason = session.support === "ok" ? null : SUPPORT_TEXT[session.support];

  return h(
    Stack,
    { gap: 8, style: PAD },
    h(Toggle, {
      key: "on",
      checked: p.on,
      label: "HDR",
      onChange: (on: boolean) => {
        write(paramsPatch({ on }));
        commit(on ? "on" : "off");
      },
    }),
    p.on ? h(HistogramView, { key: "histogram" }) : null,
    p.on
      ? h(
          Section,
          { key: "rendition", title: "Rendition" },
          h(
            Stack,
            { gap: 1 },
            slider("Headroom", "headroom", 0.5, 4, 0.1),
            slider("Start", "start", -3, 0, 0.05),
            slider("Roll-off", "rolloff", 0.5, 4, 0.1),
            slider("Highlight protection", "protection", 0, 100, 1),
          ),
        )
      : null,
    p.on
      ? h(
          Section,
          { key: "view", title: "View" },
          h(
            Stack,
            { gap: 4 },
            h(Toggle, {
              checked: session.preview && session.support === "ok",
              label: "HDR preview",
              onChange: (on: boolean) => store().getState().setPreview(on && session.support === "ok"),
            }),
            previewReason ? h("p", { style: hint }, previewReason) : null,
            h(Toggle, { checked: session.visualize, label: "Visualize HDR", onChange: (on: boolean) => store().getState().setVisualize(on) }),
          ),
        )
      : null,
  );
}
