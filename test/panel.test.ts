import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FramePair } from "../src/frames";
import { HistogramView } from "../src/HistogramView";
import { HdrPanel } from "../src/Panel";
import { KEY } from "../src/params";
import { SUPPORT_TEXT } from "../src/preview-support";
import { initRuntime } from "../src/runtime";
import type { SafelightAPI, StoreApi } from "../src/safelight";
import { initStore, store } from "../src/store";
import { createStore, fakeReact, mount, type FakeElement } from "./support/fake-host";

interface DevState {
  photoId: string | null;
  params: object;
  paramBag: Record<string, unknown>;
  previewParamBag?: Record<string, unknown> | null;
  setDynParams: ReturnType<typeof vi.fn>;
  commitEdit: ReturnType<typeof vi.fn>;
}

// Stand-ins the host would supply; the tests find them in the element tree by identity.
const Toggle = () => null;
const Section = () => null;
const Stack = () => null;
const Slider = () => null;
const tokens = { textMuted: "MUTED", textSecondary: "SECONDARY", accent: "ACCENT" };

let dev: StoreApi<DevState>;
let mediaListeners: (() => void)[];
let mediaMatches: boolean;

const tick = () => new Promise((r) => setTimeout(r, 0));
const isElement = (x: unknown): x is FakeElement => typeof x === "object" && x !== null && "type" in x && "children" in x;

/** Every element in the tree, depth first. */
function walk(el: FakeElement | null): FakeElement[] {
  if (!el) return [];
  return [el, ...el.children.filter(isElement).flatMap(walk)];
}
const ofType = (el: FakeElement | null, type: unknown) => walk(el).filter((e) => e.type === type);
const sliders = (el: FakeElement | null) => ofType(el, Slider);
const textOf = (el: FakeElement): string => el.children.filter((c): c is string => typeof c === "string").join("");

beforeEach(() => {
  mediaListeners = [];
  mediaMatches = false;
  dev = createStore<DevState>(() => ({
    photoId: "p1",
    params: { processVersion: 2 },
    paramBag: { [KEY.on]: 1 },
    setDynParams: vi.fn(),
    commitEdit: vi.fn(() => Promise.resolve()),
  }));
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: mediaMatches,
      addEventListener: (_: string, cb: () => void) => mediaListeners.push(cb),
      removeEventListener: (_: string, cb: () => void) => void mediaListeners.splice(mediaListeners.indexOf(cb), 1),
    }),
  });
  initRuntime({
    react: fakeReact,
    stores: { create: createStore, useDevelopStore: dev },
    components: { Slider },
    ui: { Toggle, Section, Stack, tokens },
  } as unknown as SafelightAPI);
  initStore();
});

afterEach(() => vi.unstubAllGlobals());

describe("HdrPanel: what it shows", () => {
  it("asks for a photo first", () => {
    dev.setState({ photoId: null });
    const el = mount(HdrPanel).render();
    expect(walk(el).some((e) => e.type === "p" && textOf(e).includes("Open a photo"))).toBe(true);
    expect(ofType(el, Toggle)).toHaveLength(0);
  });

  it("explains the older processing instead of showing controls", () => {
    dev.setState({ params: { processVersion: 1 } });
    const el = mount(HdrPanel).render();
    expect(walk(el).some((e) => e.type === "p" && textOf(e).includes("Update processing"))).toBe(true);
    expect(ofType(el, Toggle)).toHaveLength(0);
    expect(sliders(el)).toHaveLength(0);
  });

  it("shows only the switch while HDR is off", () => {
    dev.setState({ paramBag: { [KEY.on]: 0 } });
    const el = mount(HdrPanel).render();
    expect(ofType(el, Toggle)).toHaveLength(1);
    expect(sliders(el)).toHaveLength(0);
    expect(ofType(el, HistogramView)).toHaveLength(0);
  });

  it("shows the histogram, the four sliders and the view toggles while HDR is on", () => {
    const el = mount(HdrPanel).render();
    expect(ofType(el, HistogramView)).toHaveLength(1);
    expect(sliders(el).map((s) => s.props?.label)).toEqual(["Headroom", "Start", "Roll-off", "Highlight protection"]);
    expect(ofType(el, Toggle).map((t) => t.props?.label)).toEqual(["HDR", "HDR preview", "Visualize HDR"]);
  });

  it("gives each slider the stage's range and its default for double-click reset", () => {
    const el = mount(HdrPanel).render();
    const by = Object.fromEntries(sliders(el).map((s) => [s.props?.label as string, s.props]));
    expect(by["Headroom"]).toMatchObject({ value: 2, min: 0.5, max: 4, step: 0.1, defaultValue: 2 });
    expect(by["Start"]).toMatchObject({ value: -0.25, min: -3, max: 0, step: 0.05, defaultValue: -0.25 });
    expect(by["Roll-off"]).toMatchObject({ value: 1.5, min: 0.5, max: 4, defaultValue: 1.5 });
    expect(by["Highlight protection"]).toMatchObject({ value: 50, min: 0, max: 100, step: 1, defaultValue: 50 });
  });

  it("reads the slider values from the photo's bag", () => {
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3.2, [KEY.protection]: 10 } });
    const by = Object.fromEntries(sliders(mount(HdrPanel).render()).map((s) => [s.props?.label as string, s.props?.value]));
    expect(by["Headroom"]).toBe(3.2);
    expect(by["Highlight protection"]).toBe(10);
  });

  it("leaves the histogram's headroom to its pair, and shows the photo's on the slider while a preset is hovered", () => {
    dev.setState({
      paramBag: { [KEY.on]: 1, [KEY.headroom]: 3.2 },
      previewParamBag: { [KEY.on]: 1, [KEY.headroom]: 1.5 },
    });
    const el = mount(HdrPanel).render();
    expect(ofType(el, HistogramView)[0].props).not.toHaveProperty("headroom");
    const by = Object.fromEntries(sliders(el).map((s) => [s.props?.label as string, s.props?.value]));
    expect(by["Headroom"]).toBe(3.2);
  });
});

describe("HdrPanel: what it writes", () => {
  it("writes each slider to its own stage key, and commits one undo step on release", () => {
    const el = mount(HdrPanel).render();
    const keys: Record<string, string> = {
      Headroom: KEY.headroom,
      Start: KEY.start,
      "Roll-off": KEY.rolloff,
      "Highlight protection": KEY.protection,
    };
    for (const s of sliders(el)) {
      const label = s.props?.label as string;
      (s.props?.onChange as (v: number) => void)(1.5);
      expect(dev.getState().setDynParams).toHaveBeenLastCalledWith({ [keys[label]]: 1.5 });
      (s.props?.onCommit as () => void)();
      expect(dev.getState().commitEdit).toHaveBeenLastCalledWith(`HDR ${label.toLowerCase()}`);
    }
  });

  it("switches HDR on and off as one named edit", () => {
    dev.setState({ paramBag: { [KEY.on]: 0 } });
    const [toggle] = ofType(mount(HdrPanel).render(), Toggle);
    (toggle.props?.onChange as (on: boolean) => void)(true);
    expect(dev.getState().setDynParams).toHaveBeenLastCalledWith({ [KEY.on]: 1 });
    expect(dev.getState().commitEdit).toHaveBeenLastCalledWith("HDR on");
    (toggle.props?.onChange as (on: boolean) => void)(false);
    expect(dev.getState().setDynParams).toHaveBeenLastCalledWith({ [KEY.on]: 0 });
    expect(dev.getState().commitEdit).toHaveBeenLastCalledWith("HDR off");
  });
});

describe("HdrPanel: the view toggles", () => {
  const toggles = (el: FakeElement | null) => ofType(el, Toggle).filter((t) => t.props?.label !== "HDR");

  it("refuses the preview and says why while the display can't show it", () => {
    store().getState().setSupport("no-hdr-display");
    const el = mount(HdrPanel).render();
    const [preview] = toggles(el);
    expect(preview.props?.checked).toBe(false);
    (preview.props?.onChange as (on: boolean) => void)(true);
    expect(store().getState().preview).toBe(false);
    expect(walk(el).some((e) => e.type === "p" && textOf(e) === SUPPORT_TEXT["no-hdr-display"])).toBe(true);
  });

  it("turns the preview on where it is supported, with no reason shown", () => {
    store().getState().setSupport("ok");
    const el = mount(HdrPanel).render();
    const [preview] = toggles(el);
    (preview.props?.onChange as (on: boolean) => void)(true);
    expect(store().getState().preview).toBe(true);
    expect(walk(el).some((e) => e.type === "p")).toBe(false);
  });

  it("shows a stored preview as off once the display stops supporting it", () => {
    store().getState().setSupport("no-webgpu");
    store().getState().setPreview(true);
    const [preview] = toggles(mount(HdrPanel).render());
    expect(preview.props?.checked).toBe(false);
  });

  it("switches Visualize HDR", () => {
    const [, visualize] = toggles(mount(HdrPanel).render());
    (visualize.props?.onChange as (on: boolean) => void)(true);
    expect(store().getState().visualize).toBe(true);
  });

  it("uses the theme's muted colour for the reason, not a hand-written variable", () => {
    store().getState().setSupport("no-webgpu");
    const reason = walk(mount(HdrPanel).render()).find((e) => e.type === "p");
    expect((reason?.props?.style as { color: string }).color).toBe("MUTED");
  });
});

describe("HdrPanel: lifetime", () => {
  it("counts itself as an open panel while mounted", () => {
    const view = mount(HdrPanel);
    view.render();
    expect(store().getState().panels).toBe(1);
    view.unmount();
    expect(store().getState().panels).toBe(0);
  });

  // The check runs from activate() on (store.watchSupport), since the preview
  // shows with the panel closed; the panel only reads its answer.
  it("neither checks the display nor listens to it", async () => {
    const view = mount(HdrPanel);
    view.render();
    await tick();
    expect(mediaListeners).toHaveLength(0);
    expect(store().getState().support).toBe("checking");
    view.unmount();
  });
});

describe("HistogramView", () => {
  const frame = (...px: number[][]) => ({ data: Uint8ClampedArray.from(px.flat()), width: px.length, height: 1 });
  const WHITE = [255, 255, 255, 255];
  const bitmap = () => ({ width: 2, height: 1, close: () => {} }) as unknown as ImageBitmap;
  const capturedAt = (headroom: number): FramePair => ({ sdr: bitmap(), gain: bitmap(), nonce: 1, headroom, geometry: "" });
  /** One pixel at SDR white with no gain, one lifted to the top of the range. */
  const samples = () => ({ sdr: frame(WHITE, WHITE), gain: frame([0, 0, 0, 255], [255, 0, 0, 255]) });
  const bars = (el: FakeElement | null) => (el?.children ?? []).filter(isElement).filter((e) => e.type === "rect");

  it("says so when there is no frame", () => {
    const el = mount(() => HistogramView()).render();
    expect(el?.type).toBe("div");
    expect(textOf(el!)).toBe("No frame");
  });

  it("decodes with the headroom its pair was captured with, not the photo's current one", () => {
    dev.setState({ paramBag: { [KEY.on]: 1, [KEY.headroom]: 3 } });
    store().getState().setPair(capturedAt(2), samples());
    const view = mount(() => HistogramView());
    let el = view.render();
    // Stops -8 to 2, four bins a stop; the lifted pixel lands in the top bin.
    expect(bars(el)).toHaveLength(40);
    expect(bars(el)[39].props).toMatchObject({ height: 56 });

    store().getState().setPair(capturedAt(3), samples());
    el = view.render();
    expect(bars(el)).toHaveLength(44);
    expect(bars(el)[43].props).toMatchObject({ height: 56 });
  });

  it("draws one bar per bin, SDR in the muted colour and above SDR white in the accent colour", () => {
    store().getState().setPair(capturedAt(2), samples());
    const el = mount(() => HistogramView()).render();
    expect(el?.type).toBe("svg");
    expect(el?.props?.viewBox).toBe("0 0 40 56");
    const drawn = bars(el);
    expect(drawn).toHaveLength(40);
    // SDR white closes the last SDR bin (index 31); the lifted pixel lands in the top bin.
    expect(drawn[31].props).toMatchObject({ fill: "MUTED", height: 56 });
    expect(drawn[39].props).toMatchObject({ fill: "ACCENT", height: 56 });
    expect(drawn.filter((b) => b.props?.height !== 0)).toHaveLength(2);
    // The boundary is exact: bin 31 is the last SDR bin, bin 32 the first above white.
    expect(drawn.map((b) => b.props?.fill)).toEqual(Array.from({ length: 40 }, (_, i) => (i < 32 ? "MUTED" : "ACCENT")));
    const line = (el?.children ?? []).filter(isElement).find((e) => e.type === "line");
    expect(line?.props).toMatchObject({ x1: 32, x2: 32, stroke: "SECONDARY" });
  });
});
