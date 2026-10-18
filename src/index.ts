// HDR Editing — Safelight extension (MIT).
//
// HDR from the SDR edit, as a gain map: one output-encode stage (stage.ts)
// that renders the gain map on request, the Develop panel (Panel.ts), the
// overlay that drives frame pairs and shows the HDR preview and Visualize HDR
// (HdrOverlay.ts), a display-headroom preference, and the Export panel's HDR
// section (export.ts).

import { avifWorker } from "./avif-worker-client";
import { PROCESSOR_FIELDS, liveExportDeps, processExport } from "./export";
import { DISPLAY_HEADROOM_KEY, HdrOverlay } from "./HdrOverlay";
import { HdrPanel } from "./Panel";
import { OVERLAY_ID, PANEL_ID, PROCESSOR_ID, resetPatch } from "./params";
import { api, initRuntime } from "./runtime";
import type { SafelightAPI } from "./safelight";
import { gainStage } from "./stage";
import { clearStore, initStore, unwatchSupport, watchSupport } from "./store";

function reset(): void {
  const dev = api().stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit("HDR reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  initStore();
  watchSupport();

  host.registerProcessingStage(gainStage());

  host.registerPanel({
    id: PANEL_ID,
    title: "HDR",
    component: HdrPanel,
    // Right after core Basic (order 5), whose tone decisions it extends.
    defaultDock: { module: "develop", direction: "right", order: 5.5, width: 280 },
    onReset: reset,
  });

  host.registerSlot({ id: OVERLAY_ID, slot: "develop-canvas-overlay", component: HdrOverlay, order: 50 });

  host.registerSettings({
    title: "HDR Editing",
    keywords: ["hdr", "headroom", "display"],
    fields: [
      {
        key: DISPLAY_HEADROOM_KEY,
        label: "Display headroom (stops)",
        hint: "How far above SDR white your display can go. The HDR preview scales its highlights to fit; no system API reports it.",
        type: "number",
        default: 2,
        min: 0.5,
        max: 4,
        step: 0.1,
      },
    ],
  });

  host.registerExportProcessor({
    id: PROCESSOR_ID,
    label: "HDR",
    settings: PROCESSOR_FIELDS,
    // The context carries the export's long edge, which the nested renders
    // must repeat to land on the delivered file's pixel grid.
    process: (blob, photo, settings, context) => processExport(blob, photo, settings, context, liveExportDeps()),
  });
}

export function deactivate(): void {
  avifWorker.stop();
  unwatchSupport();
  try {
    clearStore();
    const host = api();
    host.unregisterProcessingStage(gainStage().id);
    host.unregisterSlot(OVERLAY_ID);
  } catch {
    /* activate() never ran — nothing to tear down */
  }
}
