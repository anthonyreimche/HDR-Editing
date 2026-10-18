import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avifWorker } from "../src/avif-worker-client";
import { activate, deactivate } from "../src/index";
import { encodeGreyJpeg } from "../src/jpeg-encode";
import { DEFAULTS, KEY, OVERLAY_ID, PANEL_ID, PROCESSOR_ID, STAGE_ID, readParams } from "../src/params";
import type {
  DevelopParams,
  DevelopStoreState,
  ExportProcessorContribution,
  ExportSettingsPatch,
  PanelContribution,
  ProcessingStageContribution,
  SafelightAPI,
  SettingsContribution,
  SlotContribution,
} from "../src/safelight";
import { store } from "../src/store";
import { createStore } from "./support/fake-host";

const PHOTO = { id: "p", exif: {} };

function fakeApi() {
  const registered = {
    stages: [] as ProcessingStageContribution[],
    panels: [] as PanelContribution[],
    slots: [] as SlotContribution[],
    settings: [] as SettingsContribution[],
    processors: [] as ExportProcessorContribution[],
    unregisteredStages: [] as string[],
    unregisteredSlots: [] as string[],
  };
  const commits: string[] = [];
  /** The settings every nested render was asked for. */
  const renders: (ExportSettingsPatch | undefined)[] = [];
  const develop = createStore<DevelopStoreState>((set) => ({
    photoId: "p",
    params: { processVersion: 2 } as unknown as DevelopParams,
    previewParams: null,
    paramBag: {},
    previewParamBag: null,
    histogram: null,
    activeTool: "none",
    cropping: false,
    bypassedPanels: {},
    setDynParams: (patch) => set((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => void commits.push(label),
  }));
  const host = {
    version: 1,
    extensionId: "hdr-editing",
    registerProcessingStage: (c: ProcessingStageContribution) => void registered.stages.push(c),
    unregisterProcessingStage: (id: string) => void registered.unregisteredStages.push(id),
    registerPanel: (c: PanelContribution) => void registered.panels.push(c),
    registerSlot: (c: SlotContribution) => void registered.slots.push(c),
    unregisterSlot: (id: string) => void registered.unregisteredSlots.push(id),
    registerSettings: (c: SettingsContribution) => void registered.settings.push(c),
    registerExportProcessor: (c: ExportProcessorContribution) => void registered.processors.push(c),
    stores: { create: createStore, useDevelopStore: develop },
    // A photo with HDR on, current processing.
    catalog: {
      getEditState: async () => ({
        photoId: "p",
        stack: [{ params: { processVersion: 2 } as unknown as DevelopParams, paramBag: { [KEY.on]: 1 } }],
        currentIndex: 0,
      }),
    },
    // A render that yields nothing: the processor falls back to the SDR file,
    // but not before it has asked for the nested render being counted.
    export: {
      renderPhotos: async (_photos: unknown, settings?: ExportSettingsPatch) => {
        renders.push(settings);
        return [{ blob: null, width: 0, height: 0 }];
      },
    },
  } as unknown as SafelightAPI;
  return { host, registered, develop, commits, renders };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
let mediaListeners: (() => void)[];
let hdrDisplay: boolean;

describe("activate", () => {
  beforeEach(() => {
    mediaListeners = [];
    hdrDisplay = false;
    vi.stubGlobal("window", {
      matchMedia: () => ({
        get matches() {
          return hdrDisplay;
        },
        addEventListener: (_: string, cb: () => void) => void mediaListeners.push(cb),
        removeEventListener: (_: string, cb: () => void) => void mediaListeners.splice(mediaListeners.indexOf(cb), 1),
      }),
    });
  });

  afterEach(() => {
    deactivate();
    vi.unstubAllGlobals();
  });

  it("registers the stage, the panel, the overlay, the display setting and the export section", () => {
    const { host, registered } = fakeApi();
    activate(host);
    expect(registered.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(registered.panels[0]).toMatchObject({ id: PANEL_ID, title: "HDR", defaultDock: { module: "develop", direction: "right", order: 5.5 } });
    expect(registered.slots).toMatchObject([{ id: OVERLAY_ID, slot: "develop-canvas-overlay" }]);
    expect(registered.settings[0].fields).toMatchObject([{ key: "displayHeadroom", type: "number", default: 2, min: 0.5, max: 4 }]);
    expect(registered.processors[0]).toMatchObject({ id: PROCESSOR_ID, label: "HDR" });
    expect(registered.processors[0].settings!.map((f) => f.key)).toEqual(["output", "avifQuality"]);
  });

  it("passes exports through untouched while HDR output is off", async () => {
    const { host, registered, renders } = fakeApi();
    activate(host);
    const blob = new Blob(["x"], { type: "image/jpeg" });
    expect(await registered.processors[0].process(blob, PHOTO, { output: "off" }, { longEdge: null })).toBe(blob);
    expect(renders).toEqual([]);
  });

  it("hands the export's long edge to the nested renders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { host, registered, renders } = fakeApi();
      activate(host);
      const jpeg = new Blob([new Uint8Array(encodeGreyJpeg(new Uint8Array(40 * 30).fill(180), 40, 30, 90))], { type: "image/jpeg" });
      const out = await registered.processors[0].process(jpeg, PHOTO, { output: "ultrahdr" }, { longEdge: 1600 });
      expect(renders).toMatchObject([{ longEdge: 1600 }]);
      // The render came back empty, so the core's own file is what ships.
      expect(out).toBe(jpeg);
    } finally {
      warn.mockRestore();
    }
  });

  it("resets the photo's HDR from the dock header as one step", () => {
    const { host, registered, develop, commits } = fakeApi();
    activate(host);
    develop.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 4 } });
    registered.panels[0].onReset?.();
    expect(readParams(develop.getState().paramBag)).toEqual(DEFAULTS);
    expect(commits).toEqual(["HDR reset"]);
  });

  it("drops the stage and the overlay on deactivate", () => {
    const { host, registered } = fakeApi();
    activate(host);
    deactivate();
    expect(registered.unregisteredStages).toEqual([STAGE_ID]);
    expect(registered.unregisteredSlots).toEqual([OVERLAY_ID]);
  });

  it("follows the display's HDR mode with no HDR panel open, until deactivate", async () => {
    activate(fakeApi().host);
    await tick();
    expect(store().getState().panels).toBe(0);
    expect(store().getState().support).toBe("no-hdr-display");
    hdrDisplay = true;
    for (const cb of [...mediaListeners]) cb();
    await tick();
    // No adapter in node, so an HDR display lands on "no-webgpu".
    expect(store().getState().support).toBe("no-webgpu");
    deactivate();
    expect(mediaListeners).toHaveLength(0);
  });

  it("stops the AVIF worker on deactivate, ending an encode in progress", async () => {
    const workers: { terminated: boolean }[] = [];
    vi.stubGlobal("location", { origin: "app://safelight" });
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        onmessageerror = null;
        terminated = false;
        constructor() {
          workers.push(this);
        }
        postMessage(): void {}
        terminate(): void {
          this.terminated = true;
        }
      },
    );
    activate(fakeApi().host);
    const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const pending = avifWorker.encode(frame, { ...frame, data: new Uint8ClampedArray(16) }, 2, 80);
    deactivate();
    await expect(pending).rejects.toThrow("the AVIF worker stopped");
    expect(workers.map((w) => w.terminated)).toEqual([true]);
  });
});
