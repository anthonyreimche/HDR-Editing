// The live HDR preview: a WebGPU canvas over the Develop canvas, configured
// rgba16float with extended tone mapping, compositing the frame pair. Shown
// only where the support check passed; any GPU failure hides it.

import type { CSSProperties, ReactElement } from "react";
import type { FramePair } from "./frames";
import { OFFSET, quantizeHeadroom } from "./model";
import { PREVIEW_WGSL } from "./preview-wgsl";
import { api, h } from "./runtime";
import type { OverlayRect } from "./safelight";

interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  uniforms: GPUBuffer;
}

interface PreviewProps {
  pair: FramePair;
  headroom: number;
  weight: number;
  rect: OverlayRect;
}

/** Called when the device fails after init: the layer should hide. */
type OnFailure = (why: string, detail?: unknown) => void;

export async function initGpu(canvas: HTMLCanvasElement, onFailure: OnFailure): Promise<Gpu | null> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  // Whatever stops init short of a finished Gpu must not leave the device alive.
  let ready = false;
  try {
    // A device reports a bad draw or a reset later, as events rather than
    // exceptions. The opaque canvas would then sit black over the photo.
    device.addEventListener("uncapturederror", (event) => onFailure("the GPU reported an error", event.error));
    void device.lost.then((info) => {
      // Destroying the device ourselves also resolves this.
      if (info.reason !== "destroyed") onFailure("the GPU device was lost", info.message);
    });
    const context = canvas.getContext("webgpu");
    if (!context) return null;
    const config: GPUCanvasConfiguration & { toneMapping: { mode: "extended" } } = {
      device,
      format: "rgba16float",
      colorSpace: "srgb",
      alphaMode: "opaque",
      toneMapping: { mode: "extended" },
    };
    context.configure(config);
    const module = device.createShaderModule({ code: PREVIEW_WGSL });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    ready = true;
    return { device, context, pipeline, uniforms };
  } finally {
    if (!ready) device.destroy();
  }
}

function draw(gpu: Gpu, canvas: HTMLCanvasElement, pair: FramePair, headroom: number, weight: number): void {
  // A closed bitmap reports 0×0. The store closes a superseded pair a moment
  // before the re-render that hands this layer the new one, whose draw follows.
  if (pair.sdr.width === 0 || pair.gain.width === 0) return;
  const { device, context, pipeline, uniforms } = gpu;
  if (canvas.width !== pair.sdr.width) canvas.width = pair.sdr.width;
  if (canvas.height !== pair.sdr.height) canvas.height = pair.sdr.height;
  const upload = (bitmap: ImageBitmap) => {
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    return texture;
  };
  const sdr = upload(pair.sdr);
  const gain = upload(pair.gain);
  device.queue.writeBuffer(uniforms, 0, new Float32Array([quantizeHeadroom(headroom), weight, OFFSET, 0]));
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sdr.createView() },
      { binding: 1, resource: gain.createView() },
      { binding: 2, resource: { buffer: uniforms } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  // Freed once the submitted work that reads them completes.
  sdr.destroy();
  gain.destroy();
}

export function PreviewLayer(props: PreviewProps): ReactElement | null {
  const { useEffect, useRef, useState } = api().react;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const gpu = useRef<Gpu | null>(null);
  const latest = useRef(props);
  const warned = useRef(false);
  const [failed, setFailed] = useState(false);

  // Any failure hides the layer; the first one says why.
  const hide = (why: string, detail?: unknown) => {
    if (!warned.current) {
      warned.current = true;
      console.warn(`[hdr-editing] The HDR preview was hidden: ${why}.`, detail);
    }
    setFailed(true);
  };

  // The GPU comes up asynchronously. By then the props the first effect saw
  // can name a superseded pair whose bitmaps are closed, so the first draw
  // reads the latest ones. Declared first, so it runs before the effects below.
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let alive = true;
    const el = canvas.current;
    if (!el) return;
    initGpu(el, (why, detail) => {
      if (alive) hide(why, detail);
    })
      .then((g) => {
        if (!alive) {
          g?.device.destroy();
          return;
        }
        if (!g) {
          hide("WebGPU gave no adapter or canvas context");
          return;
        }
        gpu.current = g;
        const now = latest.current;
        draw(g, el, now.pair, now.headroom, now.weight);
      })
      .catch((err) => {
        if (alive) hide("the GPU could not be set up", err);
      });
    return () => {
      alive = false;
      gpu.current?.uniforms.destroy();
      gpu.current?.device.destroy();
      gpu.current = null;
    };
  }, []);

  useEffect(() => {
    const g = gpu.current;
    if (!g || !canvas.current) return;
    try {
      draw(g, canvas.current, props.pair, props.headroom, props.weight);
    } catch (err) {
      hide("drawing failed", err);
    }
  }, [props.pair, props.headroom, props.weight]);

  if (failed) return null;
  const style: CSSProperties = {
    position: "absolute",
    left: `${props.rect.x}px`,
    top: `${props.rect.y}px`,
    width: `${props.rect.w}px`,
    height: `${props.rect.h}px`,
    pointerEvents: "none",
  };
  return h("canvas", { ref: canvas, style });
}
