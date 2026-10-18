import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FramePair } from "../src/frames";
import { initRuntime } from "../src/runtime";
import type { SafelightAPI } from "../src/safelight";
import { clearStore, initStore, store, unwatchSupport, watchSupport } from "../src/store";
import { createStore } from "./support/fake-host";

type Closable = ImageBitmap & { close: ReturnType<typeof vi.fn> };
type ClosablePair = FramePair & { sdr: Closable; gain: Closable };

const bitmap = () => ({ width: 8, height: 6, close: vi.fn() }) as unknown as Closable;
const pair = (nonce = 1): ClosablePair => ({ sdr: bitmap(), gain: bitmap(), nonce, headroom: 2, geometry: "" });
const frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
const samples = { sdr: frame, gain: frame };
const closes = (p: FramePair) => [(p.sdr as Closable).close.mock.calls.length, (p.gain as Closable).close.mock.calls.length];

beforeEach(() => {
  initRuntime({ stores: { create: createStore } } as unknown as SafelightAPI);
  initStore();
});

describe("session store: who closes a pair's bitmaps", () => {
  it("closes both bitmaps of a superseded pair exactly once, and never the new one's", () => {
    const a = pair();
    const b = pair(2);
    store().getState().setPair(a, samples);
    expect(closes(a)).toEqual([0, 0]);
    store().getState().setPair(b, samples);
    expect(closes(a)).toEqual([1, 1]);
    expect(closes(b)).toEqual([0, 0]);
    expect(store().getState().pair).toBe(b);
    // A third pair does not touch the first again.
    store().getState().setPair(pair(3), samples);
    expect(closes(a)).toEqual([1, 1]);
    expect(closes(b)).toEqual([1, 1]);
  });

  it("closes nothing when the same pair is set again (only its samples change)", () => {
    const a = pair();
    store().getState().setPair(a, null);
    store().getState().setPair(a, samples);
    expect(closes(a)).toEqual([0, 0]);
    expect(store().getState().samples).toBe(samples);
  });

  it("closes the pair when it is cleared, once, and clears its samples", () => {
    const a = pair();
    store().getState().setPair(a, samples);
    store().getState().setPair(null, null);
    store().getState().setPair(null, null);
    expect(closes(a)).toEqual([1, 1]);
    expect(store().getState().pair).toBeNull();
    expect(store().getState().samples).toBeNull();
  });

  it("clearStore drops the pair the same way", () => {
    const a = pair();
    store().getState().setPair(a, samples);
    clearStore();
    expect(closes(a)).toEqual([1, 1]);
    expect(store().getState().pair).toBeNull();
  });

  it("closes the pair of the store it replaces when initialised again", () => {
    const a = pair();
    store().getState().setPair(a, samples);
    initStore();
    expect(closes(a)).toEqual([1, 1]);
    expect(store().getState().pair).toBeNull();
  });

  it("never hands a subscriber a closed pair", () => {
    const a = pair();
    const b = pair(2);
    store().getState().setPair(a, null);
    const seen: number[][] = [];
    store().subscribe((s) => seen.push(s.pair ? closes(s.pair) : [-1, -1]));
    store().getState().setPair(b, null);
    expect(seen).toEqual([[0, 0]]);
  });
});

describe("session store: panels and view toggles", () => {
  it("counts open panels and never goes below zero", () => {
    const a = store().getState().panelMounted();
    const b = store().getState().panelMounted();
    expect(store().getState().panels).toBe(2);
    a();
    expect(store().getState().panels).toBe(1);
    b();
    b();
    expect(store().getState().panels).toBe(0);
  });

  it("starts with both views off and the support still being checked", () => {
    expect(store().getState()).toMatchObject({ preview: false, visualize: false, support: "checking", pair: null, samples: null });
  });

  it("fails loudly when read before activate()", async () => {
    vi.resetModules();
    const fresh = await import("../src/store");
    expect(() => fresh.store()).toThrow("before activate()");
  });
});

// The preview shows with the HDR panel closed, so the check that the display
// can show it runs from activate() on, not while a panel is open.
describe("session store: the HDR display check", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let listeners: (() => void)[];
  let hdrDisplay: boolean;
  const support = () => store().getState().support;
  const change = (hdr: boolean) => {
    hdrDisplay = hdr;
    for (const cb of [...listeners]) cb();
  };

  beforeEach(() => {
    listeners = [];
    hdrDisplay = false;
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        get matches() {
          return query === "(dynamic-range: high)" && hdrDisplay;
        },
        addEventListener: (_: string, cb: () => void) => void listeners.push(cb),
        removeEventListener: (_: string, cb: () => void) => void listeners.splice(listeners.indexOf(cb), 1),
      }),
    });
  });

  afterEach(() => {
    unwatchSupport();
    vi.unstubAllGlobals();
  });

  it("checks the display, and again each time its HDR mode changes, with no panel open", async () => {
    watchSupport();
    await tick();
    expect(store().getState().panels).toBe(0);
    expect(support()).toBe("no-hdr-display");
    // No adapter in node, so an HDR display lands on "no-webgpu".
    change(true);
    await tick();
    expect(support()).toBe("no-webgpu");
    change(false);
    await tick();
    expect(support()).toBe("no-hdr-display");
  });

  it("keeps the latest answer when an earlier check finishes after it", async () => {
    let answerAdapter: (adapter: object | null) => void = () => {};
    vi.stubGlobal("navigator", { gpu: { requestAdapter: () => new Promise((r) => (answerAdapter = r)) } });
    hdrDisplay = true;
    watchSupport();
    change(false); // moved to an SDR display while the adapter is being asked for
    await tick();
    answerAdapter({});
    await tick();
    expect(support()).toBe("no-hdr-display");
  });

  it("stops listening when unwatched, and drops a check still in flight", async () => {
    watchSupport();
    expect(listeners).toHaveLength(1);
    unwatchSupport();
    await tick();
    expect(listeners).toHaveLength(0);
    expect(support()).toBe("checking");
  });

  it("listens once however often it is started", () => {
    watchSupport();
    watchSupport();
    expect(listeners).toHaveLength(1);
  });
});
