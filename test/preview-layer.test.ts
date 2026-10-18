import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initGpu, PreviewLayer } from "../src/PreviewLayer";
import { initRuntime } from "../src/runtime";
import type { FramePair } from "../src/frames";
import type { SafelightAPI } from "../src/safelight";
import { fakeReact, mount } from "./support/fake-host";

// A stand-in for the parts of WebGPU the layer touches. It records calls and
// lets a test raise the asynchronous failures a real device reports later.

type Listener = (event: { error: { message: string } }) => void;

interface FakeDevice {
  destroy: ReturnType<typeof vi.fn>;
  queue: {
    copyExternalImageToTexture: ReturnType<typeof vi.fn>;
    writeBuffer: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
  };
  uncaptured: Listener[];
  lose(reason: string): void;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let device: FakeDevice;
let context: { configure: ReturnType<typeof vi.fn>; getCurrentTexture: () => { createView: () => object } };
let breakIn: "configure" | "pipeline" | "no-context" | null;
let hasAdapter: boolean;
let uniformBuffers: { destroy: ReturnType<typeof vi.fn> }[];

function makeDevice(): FakeDevice {
  let lose: (info: { reason: string; message: string }) => void = () => {};
  const lost = new Promise<{ reason: string; message: string }>((resolve) => (lose = resolve));
  const uncaptured: Listener[] = [];
  const texture = () => ({ createView: () => ({}), destroy: vi.fn() });
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const dev = {
    destroy: vi.fn(),
    lost,
    uncaptured,
    lose: (reason: string) => lose({ reason, message: `lost: ${reason}` }),
    addEventListener: (type: string, cb: Listener) => {
      if (type === "uncapturederror") uncaptured.push(cb);
    },
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn() },
    createShaderModule: () => ({}),
    createRenderPipeline: () => {
      if (breakIn === "pipeline") throw new Error("pipeline rejected");
      return { getBindGroupLayout: () => ({}) };
    },
    createBuffer: () => {
      const buffer = { destroy: vi.fn() };
      uniformBuffers.push(buffer);
      return buffer;
    },
    createTexture: texture,
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
  };
  return dev as unknown as FakeDevice;
}

function makeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => (breakIn === "no-context" ? null : context),
  };
}

/** A bitmap that reports 0x0 once closed, as a real one does. */
function bitmap(width = 8, height = 6) {
  const b = {
    width,
    height,
    close: vi.fn(() => {
      b.width = 0;
      b.height = 0;
    }),
  };
  return b as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}
const pair = (nonce = 1): FramePair => ({ sdr: bitmap(), gain: bitmap(), nonce, headroom: 2, geometry: "" });

const RECT = { x: 0, y: 0, w: 80, h: 60 };
const props = (p: FramePair) => ({ pair: p, headroom: 2, weight: 1, rect: RECT });

let canvas: ReturnType<typeof makeCanvas>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  breakIn = null;
  hasAdapter = true;
  uniformBuffers = [];
  device = makeDevice();
  context = { configure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) };
  canvas = makeCanvas();
  vi.stubGlobal("navigator", {
    gpu: { requestAdapter: async () => (hasAdapter ? { requestDevice: async () => device } : null) },
  });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
  vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // The layer's canvas ref is the first ref created with null; give it the fake canvas.
  let canvasGiven = false;
  const react = {
    ...fakeReact,
    useRef: (initial: unknown) => {
      if (initial === null && !canvasGiven) {
        canvasGiven = true;
        return fakeReact.useRef(canvas);
      }
      return fakeReact.useRef(initial);
    },
  };
  initRuntime({ react } as unknown as SafelightAPI);
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("initGpu", () => {
  const init = () => initGpu(canvas as unknown as HTMLCanvasElement, () => {});

  it("returns the GPU objects and leaves the device running", async () => {
    const gpu = await init();
    expect(gpu).not.toBeNull();
    expect(device.destroy).not.toHaveBeenCalled();
    expect(context.configure).toHaveBeenCalledWith(
      expect.objectContaining({ format: "rgba16float", alphaMode: "opaque", toneMapping: { mode: "extended" } }),
    );
  });

  it("returns null without a device when there is no adapter", async () => {
    hasAdapter = false;
    expect(await init()).toBeNull();
    expect(device.destroy).not.toHaveBeenCalled();
  });

  it("destroys the device when the canvas has no WebGPU context", async () => {
    breakIn = "no-context";
    expect(await init()).toBeNull();
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the device when configuring the canvas throws", async () => {
    context.configure.mockImplementation(() => {
      throw new Error("unsupported format");
    });
    await expect(init()).rejects.toThrow("unsupported format");
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the device when building the pipeline throws", async () => {
    breakIn = "pipeline";
    await expect(init()).rejects.toThrow("pipeline rejected");
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it("reports an uncaptured error and a lost device through the callback, but not our own destroy", async () => {
    const failures: string[] = [];
    await initGpu(canvas as unknown as HTMLCanvasElement, (why) => failures.push(why));
    device.uncaptured[0]({ error: { message: "bad bind group" } });
    expect(failures).toHaveLength(1);
    device.lose("destroyed");
    await tick();
    expect(failures).toHaveLength(1);
  });

  it("reports a device lost for any other reason", async () => {
    const failures: string[] = [];
    await initGpu(canvas as unknown as HTMLCanvasElement, (why) => failures.push(why));
    device.lose("unknown");
    await tick();
    expect(failures).toHaveLength(1);
  });
});

describe("PreviewLayer", () => {
  async function shown(p: FramePair = pair()) {
    const view = mount(() => PreviewLayer(props(p)));
    expect(view.render()?.type).toBe("canvas");
    await tick();
    return view;
  }

  it("draws the pair once the GPU is up, sized to the pair", async () => {
    const p = pair();
    const view = await shown(p);
    expect(canvas.width).toBe(8);
    expect(canvas.height).toBe(6);
    const sources = device.queue.copyExternalImageToTexture.mock.calls.map((c) => c[0].source);
    expect(sources).toEqual([p.sdr, p.gain]);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
    expect(view.render()?.type).toBe("canvas");
  });

  it("draws the latest pair when the one it mounted with was closed while the GPU came up", async () => {
    const a = pair(1);
    const b = pair(2);
    let current = a;
    const view = mount(() => PreviewLayer(props(current)));
    view.render();
    a.sdr.close();
    a.gain.close();
    current = b;
    view.render();
    await tick();
    const sources = device.queue.copyExternalImageToTexture.mock.calls.map((c) => c[0].source);
    expect(sources).toEqual([b.sdr, b.gain]);
    expect(view.render()?.type).toBe("canvas");
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips a closed pair instead of failing on it", async () => {
    const a = pair();
    a.sdr.close();
    a.gain.close();
    const view = await shown(a);
    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
    expect(view.render()?.type).toBe("canvas");
  });

  it("hides on an uncaptured GPU error, with one warning", async () => {
    const view = await shown();
    device.uncaptured[0]({ error: { message: "bad bind group" } });
    device.uncaptured[0]({ error: { message: "again" } });
    expect(view.dirty).toBe(true);
    expect(view.render()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[hdr-editing]");
  });

  it("hides when the device is lost, but not when the layer destroyed it", async () => {
    const view = await shown();
    device.lose("unknown");
    await tick();
    expect(view.render()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("hides, with a warning, when the canvas can't be configured, and leaves no device behind", async () => {
    context.configure.mockImplementation(() => {
      throw new Error("unsupported format");
    });
    const view = mount(() => PreviewLayer(props(pair())));
    view.render();
    await tick();
    expect(view.render()).toBeNull();
    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("hides when the drawing itself throws", async () => {
    let current = pair();
    const view = mount(() => PreviewLayer(props(current)));
    view.render();
    await tick();
    device.queue.submit.mockImplementation(() => {
      throw new Error("device is lost");
    });
    current = pair(2);
    view.render();
    expect(view.dirty).toBe(true);
    expect(view.render()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("destroys the device on unmount, and ignores errors that arrive after it", async () => {
    const view = await shown();
    view.unmount();
    expect(device.destroy).toHaveBeenCalledTimes(1);
    expect(uniformBuffers[0].destroy).toHaveBeenCalledTimes(1);
    device.uncaptured[0]({ error: { message: "late" } });
    device.lose("destroyed");
    await tick();
    expect(warn).not.toHaveBeenCalled();
  });

  it("destroys a device that came up after the unmount", async () => {
    const view = mount(() => PreviewLayer(props(pair())));
    view.render();
    view.unmount();
    await tick();
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });
});
