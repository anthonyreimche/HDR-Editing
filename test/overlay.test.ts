import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_HEADROOM_KEY, HdrOverlay, geometryOf, publishPair } from "../src/HdrOverlay";
import { displayWeight } from "../src/preview-wgsl";
import { PreviewLayer } from "../src/PreviewLayer";
import { GAIN_MAP_PATCH, KEY } from "../src/params";
import { initRuntime } from "../src/runtime";
import type { SafelightAPI, StoreApi } from "../src/safelight";
import { initStore, store } from "../src/store";
import { VisualizeLayer } from "../src/VisualizeLayer";
import { createStore, fakeReact, mount, type FakeElement } from "./support/fake-host";

type Closable = ImageBitmap & { close: ReturnType<typeof vi.fn> };

interface DevState {
  photoId: string | null;
  params: object;
  previewParams: object | null;
  paramBag: Record<string, unknown>;
  previewParamBag: Record<string, unknown> | null;
  activeTool: string;
  cropping: boolean;
  bypassedPanels: Record<string, boolean>;
}

interface Capture {
  params: unknown;
  options: { paramBag?: Record<string, unknown> } | undefined;
  /** The stored bag when the capture was asked for: what the render worker
   *  would hold by then, since the host pushes the bag to it from the effects
   *  of a component above the overlay. */
  bag: Record<string, unknown>;
  resolve(b: ImageBitmap): void;
}

const bitmap = () => ({ width: 8, height: 6, close: vi.fn() }) as unknown as Closable;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Runs after every microtask queued before it, which is where the overlay asks for its pair. */
const flush = () => new Promise<void>((r) => queueMicrotask(r));
const RECT = { x: 4, y: 8, w: 100, h: 50 };

const LIVE = { processVersion: 2 };
const PREVIEWED = { processVersion: 2, preview: true };

let dev: StoreApi<DevState>;
let captures: Capture[];
let overlay: { rect: typeof RECT | null; nonce: number };
let displayHeadroom: number;
let settingListeners: ((key: string, value: unknown) => void)[];
let drawFails = false;

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: () => {
        if (drawFails) throw new Error("draw failed");
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    };
  }
}

beforeAll(() => vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  captures = [];
  overlay = { rect: RECT, nonce: 1 };
  displayHeadroom = 2;
  settingListeners = [];
  drawFails = false;
  dev = createStore<DevState>(() => ({
    photoId: "p1",
    params: LIVE,
    previewParams: null,
    paramBag: { [KEY.on]: 1 },
    previewParamBag: null,
    activeTool: "none",
    cropping: false,
    bypassedPanels: {},
  }));
  initRuntime({
    react: fakeReact,
    stores: { create: createStore, useDevelopStore: dev },
    settings: {
      get: <T>(key: string, fallback: T): T => (key === DISPLAY_HEADROOM_KEY ? (displayHeadroom as T) : fallback),
      onChange: (cb: (key: string, value: unknown) => void) => {
        settingListeners.push(cb);
        return () => void settingListeners.splice(settingListeners.indexOf(cb), 1);
      },
    },
    develop: {
      useDevelopOverlay: () => overlay,
      captureFrame: (params: unknown, options?: { paramBag?: Record<string, unknown> }) =>
        new Promise<ImageBitmap>((resolve) => captures.push({ params, options, bag: dev.getState().paramBag, resolve })),
    },
  } as unknown as SafelightAPI);
  initStore();
});

/** The overlay mounted while an HDR panel is open (the common case), once it has asked for its pair. */
async function mountWithPanel() {
  store().getState().panelMounted();
  const view = mount(HdrOverlay);
  view.render();
  await flush();
  return view;
}

/** Answers the oldest unanswered pair of captures with fresh bitmaps. */
async function answer(from: number) {
  const sdr = bitmap();
  const gain = bitmap();
  captures[from].resolve(sdr);
  captures[from + 1].resolve(gain);
  await tick();
  return { sdr, gain };
}

const layers = (el: FakeElement | null) => (el?.children ?? []).filter((c): c is FakeElement => c !== null);

describe("HdrOverlay: when it captures", () => {
  it("captures nothing while no panel, preview or Visualize needs the pair", async () => {
    mount(HdrOverlay).render();
    await flush();
    expect(captures).toHaveLength(0);
  });

  it("captures nothing for a photo with HDR off or on the older processing", async () => {
    dev.setState({ paramBag: { [KEY.on]: 0 } });
    await mountWithPanel();
    expect(captures).toHaveLength(0);

    dev.setState({ paramBag: { [KEY.on]: 1 }, params: { processVersion: 1 } });
    await mountWithPanel();
    expect(captures).toHaveLength(0);
  });

  it("does not count a preview the display can't show", async () => {
    store().getState().setPreview(true);
    store().getState().setSupport("no-webgpu");
    mount(HdrOverlay).render();
    await flush();
    expect(captures).toHaveLength(0);

    store().getState().setSupport("ok");
    mount(HdrOverlay).render();
    await flush();
    expect(captures).toHaveLength(2);
  });

  it("starts the SDR and gain captures in the same synchronous turn, from the develop state at that moment", async () => {
    dev.setState({ previewParams: PREVIEWED });
    await mountWithPanel();
    expect(captures).toHaveLength(2);
    expect(captures[0].params).toBe(PREVIEWED);
    expect(captures[0].options).toBeUndefined();
    expect(captures[1].params).toBe(PREVIEWED);
    expect(captures[1].options).toEqual({ paramBag: GAIN_MAP_PATCH });
    // Same turn: nothing could change the edit between the two.
    expect(captures[1].bag).toBe(captures[0].bag);
  });

  it("falls back to the stored params when no preset preview is active", async () => {
    await mountWithPanel();
    expect(captures[0].params).toBe(LIVE);
  });

  it("asks again when the edit changes", async () => {
    const view = await mountWithPanel();
    await answer(0);
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3 } });
    view.render();
    await flush();
    expect(captures).toHaveLength(4);
  });
});

describe("HdrOverlay: asking after the host has pushed the edit", () => {
  // The slot renders inside DevelopCanvas, whose own effect pushes an edited bag
  // to the render worker. React runs a child's effects before its parent's, so
  // an overlay that asked inside its effect would capture the previous edit.

  it("does not capture inside the effect", () => {
    store().getState().panelMounted();
    mount(HdrOverlay).render();
    expect(captures).toHaveLength(0);
  });

  it("captures against the bag as it stands once the parent's effects have run", async () => {
    store().getState().panelMounted();
    const view = mount(HdrOverlay);
    const edited = { [KEY.on]: 1, [KEY.headroom]: 3 };
    dev.setState({ paramBag: edited });
    view.render();
    const pushed = { [KEY.on]: 1, [KEY.headroom]: 3.5 };
    // Stands in for the parent's effect posting the bag, which runs after this render's.
    dev.setState({ paramBag: pushed });
    await flush();
    expect(captures).toHaveLength(2);
    expect(captures[0].bag).toBe(pushed);
    expect(captures[1].bag).toBe(pushed);
  });

  it("lets a re-render before the microtask cancel the stale request", async () => {
    store().getState().panelMounted();
    const view = mount(HdrOverlay);
    view.render();
    const next = { [KEY.on]: 1, [KEY.headroom]: 3 };
    dev.setState({ paramBag: next });
    view.render();
    await flush();
    // One pair, for the latest edit, not one per render: a stale request that
    // ran too would queue a second pair behind the first.
    expect(captures).toHaveLength(2);
    expect(captures[0].bag).toBe(next);
    await answer(0);
    expect(captures).toHaveLength(2);
  });

  it("asks for nothing when it unmounts before the microtask", async () => {
    store().getState().panelMounted();
    const view = mount(HdrOverlay);
    view.render();
    view.unmount();
    await flush();
    expect(captures).toHaveLength(0);
  });
});

describe("HdrOverlay: while a preset is hovered", () => {
  // Core renders previewParamBag ?? paramBag, and the captured frames show it.

  async function withPair() {
    const view = await mountWithPanel();
    await answer(0);
    return view;
  }

  it("takes whether HDR is on from the hover bag", async () => {
    dev.setState({ paramBag: { [KEY.on]: 0 }, previewParamBag: { [KEY.on]: 1 } });
    await mountWithPanel();
    expect(captures).toHaveLength(2);
  });

  it("stops asking when the hover bag has HDR off", async () => {
    dev.setState({ previewParamBag: { [KEY.on]: 0 } });
    await mountWithPanel();
    expect(captures).toHaveLength(0);
  });

  it("asks for a new pair when the hover starts and when it ends", async () => {
    const view = await withPair();
    dev.setState({ previewParamBag: { [KEY.on]: 1, [KEY.headroom]: 4 } });
    view.render();
    await flush();
    expect(captures).toHaveLength(4);
    await answer(2);
    dev.setState({ previewParamBag: null });
    view.render();
    await flush();
    expect(captures).toHaveLength(6);
  });

  it("decodes and weights the pair captured during the hover with the hover bag's headroom", async () => {
    const view = await withPair();
    store().getState().setPreview(true);
    store().getState().setSupport("ok");
    store().getState().setVisualize(true);
    dev.setState({ previewParamBag: { [KEY.on]: 1, [KEY.headroom]: 4 } });
    view.render();
    await flush();
    await answer(2);
    expect(store().getState().pair?.headroom).toBe(4);
    const [preview, visualize] = layers(view.render());
    expect(preview.type).toBe(PreviewLayer);
    expect(preview.props).toMatchObject({ headroom: 4, weight: displayWeight(2, 4) });
    expect(visualize.type).toBe(VisualizeLayer);
    expect(visualize.props).toMatchObject({ headroom: 4 });
  });
});

describe("HdrOverlay: the headroom a pair is decoded with", () => {
  // The gain map encodes each lift as a fraction of the headroom it was
  // rendered with, so decoding it with a newer headroom shows a wrong lift.

  it("keeps decoding a pair captured at headroom 2 with 2 after the headroom moves to 3, until the next pair lands", async () => {
    const view = await mountWithPanel();
    await answer(0);
    store().getState().setPreview(true);
    store().getState().setSupport("ok");
    store().getState().setVisualize(true);
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3 } });
    let [preview, visualize] = layers(view.render());
    expect(preview.props).toMatchObject({ headroom: 2, weight: displayWeight(2, 2) });
    expect(visualize.props).toMatchObject({ headroom: 2 });

    await flush();
    await answer(2);
    [preview, visualize] = layers(view.render());
    expect(preview.props).toMatchObject({ headroom: 3, weight: displayWeight(2, 3) });
    expect(visualize.props).toMatchObject({ headroom: 3 });
  });

  it("records the headroom of the bag as the captures start, not as they land", async () => {
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 2.5 } });
    await mountWithPanel();
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3.5 } });
    await answer(0);
    expect(store().getState().pair?.headroom).toBe(2.5);
  });
});

describe("HdrOverlay: who owns the bitmaps", () => {
  it("publishes the pair with its histogram readback", async () => {
    await mountWithPanel();
    const { sdr, gain } = await answer(0);
    const s = store().getState();
    expect(s.pair).toEqual({ sdr, gain, nonce: 1, headroom: 2, geometry: geometryOf(LIVE) });
    expect(s.samples?.sdr).toMatchObject({ width: 8, height: 6 });
    expect(s.samples?.gain).toMatchObject({ width: 8, height: 6 });
  });

  it("closes the pair it replaces exactly once and keeps the new one open", async () => {
    const view = await mountWithPanel();
    const first = await answer(0);
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3 } });
    view.render();
    await flush();
    const second = await answer(2);
    expect(first.sdr.close).toHaveBeenCalledTimes(1);
    expect(first.gain.close).toHaveBeenCalledTimes(1);
    expect(second.sdr.close).not.toHaveBeenCalled();
    expect(second.gain.close).not.toHaveBeenCalled();
    expect(store().getState().pair?.sdr).toBe(second.sdr);
  });

  it("closes the pair on unmount, once, and stops asking", async () => {
    const view = await mountWithPanel();
    const { sdr, gain } = await answer(0);
    view.unmount();
    expect(sdr.close).toHaveBeenCalledTimes(1);
    expect(gain.close).toHaveBeenCalledTimes(1);
    expect(store().getState().pair).toBeNull();
    expect(store().getState().samples).toBeNull();
  });

  it("closes a pair that lands after the unmount instead of publishing it", async () => {
    const view = await mountWithPanel();
    view.unmount();
    const { sdr, gain } = await answer(0);
    expect(sdr.close).toHaveBeenCalledTimes(1);
    expect(gain.close).toHaveBeenCalledTimes(1);
    expect(store().getState().pair).toBeNull();
  });

  it("closes the pair when nothing needs it any more", async () => {
    const view = await mountWithPanel();
    const { sdr, gain } = await answer(0);
    dev.setState({ paramBag: { [KEY.on]: 0 } });
    view.render();
    expect(sdr.close).toHaveBeenCalledTimes(1);
    expect(gain.close).toHaveBeenCalledTimes(1);
    expect(store().getState().pair).toBeNull();
  });

  it("keeps the pair for the layers when only the histogram readback fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    drawFails = true;
    await mountWithPanel();
    const { sdr, gain } = await answer(0);
    expect(store().getState().pair).toEqual({ sdr, gain, nonce: 1, headroom: 2, geometry: geometryOf(LIVE) });
    expect(store().getState().samples).toBeNull();
    expect(sdr.close).not.toHaveBeenCalled();
    expect(gain.close).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("publishPair(null) clears the store", () => {
    const a = { sdr: bitmap(), gain: bitmap(), nonce: 1, headroom: 2, geometry: "" };
    publishPair(a);
    publishPair(null);
    expect(a.sdr.close).toHaveBeenCalledTimes(1);
    expect(store().getState().pair).toBeNull();
  });
});

describe("HdrOverlay: what it shows", () => {
  async function withPair() {
    const view = await mountWithPanel();
    await answer(0);
    return view;
  }

  it("shows no layer unless one is switched on", async () => {
    const view = await withPair();
    const el = view.render();
    expect(layers(el)).toHaveLength(0);
  });

  it("shows Visualize HDR over the pair", async () => {
    const view = await withPair();
    store().getState().setVisualize(true);
    const [layer] = layers(view.render());
    expect(layer.type).toBe(VisualizeLayer);
    expect(layer.props).toMatchObject({ headroom: 2, rect: RECT });
  });

  it("shows the preview only where the support check passed, weighted by the display's headroom", async () => {
    const view = await withPair();
    store().getState().setPreview(true);
    expect(layers(view.render())).toHaveLength(0);

    store().getState().setSupport("ok");
    const [layer] = layers(view.render());
    expect(layer.type).toBe(PreviewLayer);
    expect(layer.props).toMatchObject({ headroom: 2, weight: 1, rect: RECT });
  });

  it("follows the display headroom setting without waiting for another edit", async () => {
    const view = await withPair();
    store().getState().setPreview(true);
    store().getState().setSupport("ok");
    view.render();

    displayHeadroom = 1;
    for (const cb of settingListeners) cb("somethingElse", 1);
    expect(view.dirty).toBe(false);
    for (const cb of settingListeners) cb(DISPLAY_HEADROOM_KEY, 1);
    expect(view.dirty).toBe(true);
    const [layer] = layers(view.render());
    expect(layer.props?.weight).toBe(displayWeight(1, 2));
  });

  it("hides the layers for a pair captured for another view, and asks for the new one", async () => {
    const view = await withPair();
    store().getState().setVisualize(true);
    expect(view.render()).not.toBeNull();
    overlay = { rect: RECT, nonce: 2 };
    expect(view.render()).toBeNull();
    await flush();
    expect(captures).toHaveLength(4);
  });

  it("hides the layers while a canvas tool or the crop is active, and before the first layout", async () => {
    const view = await withPair();
    store().getState().setVisualize(true);
    dev.setState({ activeTool: "mask" });
    expect(view.render()).toBeNull();
    dev.setState({ activeTool: "none", cropping: true });
    expect(view.render()).toBeNull();
    dev.setState({ cropping: false });
    overlay = { rect: null, nonce: 1 };
    expect(view.render()).toBeNull();
  });

  it("hides the layers while a core panel is bypassed, which the captures don't see", async () => {
    const view = await withPair();
    store().getState().setPreview(true);
    store().getState().setSupport("ok");
    store().getState().setVisualize(true);
    expect(layers(view.render())).toHaveLength(2);
    dev.setState({ bypassedPanels: { "core.basic": true } });
    expect(view.render()).toBeNull();
    dev.setState({ bypassedPanels: {} });
    expect(layers(view.render())).toHaveLength(2);
  });

  it("asks for a fresh pair when a bypass ends, since edits made during it went to a bypassed bag", async () => {
    const view = await withPair();
    const before = captures.length;
    dev.setState({ bypassedPanels: { "core.basic": true } });
    view.render();
    await flush();
    dev.setState({ bypassedPanels: {} });
    view.render();
    await flush();
    expect(captures.length).toBeGreaterThanOrEqual(before + 2);
  });

  it("unsubscribes from the setting on unmount", async () => {
    const view = await mountWithPanel();
    expect(settingListeners).toHaveLength(1);
    view.unmount();
    expect(settingListeners).toHaveLength(0);
  });
});

describe("HdrOverlay: geometry edits", () => {
  // Straighten, crop and Transform move the pixels without a new view nonce,
  // so a pair rendered under the old geometry would sit misaligned.
  const TRANSFORM = { perspectiveV: 0, perspectiveH: 0, aspect: 0, scale: 100, offsetX: 0, offsetY: 0, flipH: false, flipV: false };
  const SHAPED = {
    processVersion: 2,
    exposure: 0,
    straighten: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    transform: TRANSFORM,
  };

  async function showing() {
    dev.setState({ params: SHAPED });
    const view = await mountWithPanel();
    await answer(0);
    store().getState().setVisualize(true);
    expect(layers(view.render())).toHaveLength(1);
    return view;
  }

  it.each<[string, Record<string, unknown>]>([
    ["straighten", { straighten: 2.5 }],
    ["crop", { crop: { x: 0.1, y: 0, width: 0.8, height: 1 } }],
    ["a flip", { transform: { ...TRANSFORM, flipH: true } }],
    ["perspective", { transform: { ...TRANSFORM, perspectiveV: 12 } }],
    ["scale", { transform: { ...TRANSFORM, scale: 90 } }],
  ])("hides the layers after a change of %s until the pair for it lands", async (_what, change) => {
    const view = await showing();
    dev.setState({ params: { ...SHAPED, ...change } });
    expect(view.render()).toBeNull();
    await flush();
    expect(captures).toHaveLength(4);
    await answer(2);
    expect(layers(view.render())).toHaveLength(1);
  });

  it("keeps the layers up through a tone edit", async () => {
    const view = await showing();
    dev.setState({ params: { ...SHAPED, exposure: 1 } });
    expect(layers(view.render())).toHaveLength(1);
  });

  it("takes the same geometry written in another key order as unchanged", async () => {
    const view = await showing();
    const reordered = Object.fromEntries(Object.entries(TRANSFORM).reverse());
    dev.setState({ params: { ...SHAPED, transform: reordered, crop: { height: 1, width: 1, y: 0, x: 0 } } });
    expect(layers(view.render())).toHaveLength(1);
  });

  it("places a hovered preset's pair by the preset's geometry", async () => {
    const view = await showing();
    dev.setState({ previewParams: { ...SHAPED, straighten: 4 } });
    expect(view.render()).toBeNull();
    await flush();
    await answer(2);
    expect(layers(view.render())).toHaveLength(1);
  });
});
