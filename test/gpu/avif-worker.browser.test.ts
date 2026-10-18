// The HDR AVIF worker in Chromium, the way the app runs it: the built
// dist/avif-worker.js started from the plugin path (run.cjs serves the
// extension folder at /__plugins__/hdr-editing/, as the app does), loading the
// encoder from there. It must write the file the page wrote before the worker
// existed, byte for byte, and leave the page free while it works. run.cjs
// refuses a dist/ older than src/, so run `npm run build` first.

import { describe, expect, it } from "vitest";
import wasmUrl from "@hdr-modules/@jsquash/avif/codec/enc/avif_enc.wasm?url";
import { encodeAvif10, type AvifFactory, type AvifLoaders } from "@hdr/avif";
import { avifWorkerClient, spawnAvifWorker } from "@hdr/avif-worker-client";
import type { FrameSample } from "@hdr/frame";
import { hdrToPq10 } from "@hdr/pq";

const loaders: AvifLoaders = {
  factory: async () =>
    ((await import("@hdr-modules/@jsquash/avif/codec/enc/avif_enc.js")) as { default: AvifFactory }).default,
  wasm: async () => (await fetch(wasmUrl)).arrayBuffer(),
};

// 3.1 MP: long enough on the page (seconds) that a stall can't hide in the
// heartbeat's jitter.
const W = 2048;
const H = 1536;

function frames(): { sdr: FrameSample; gain: FrameSample } {
  const sdr = new Uint8ClampedArray(W * H * 4);
  const gain = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      sdr.set([(x * 255) / (W - 1), (y * 255) / (H - 1), ((x + y) * 255) / (W + H - 2), 255], i);
      const g = x > W / 2 ? (y * 255) / (H - 1) : 0;
      gain.set([g, g, g, 255], i);
    }
  }
  return { sdr: { data: sdr, width: W, height: H }, gain: { data: gain, width: W, height: H } };
}

/** How long the page went without running a timer while `work` ran: the
 *  longest it couldn't have answered a click. */
async function longestStall<T>(work: () => Promise<T>): Promise<{ result: T; stall: number; total: number }> {
  let last = performance.now();
  let stall = 0;
  let beating = true;
  const beat = () => {
    const now = performance.now();
    stall = Math.max(stall, now - last);
    last = now;
    if (beating) setTimeout(beat, 4);
  };
  setTimeout(beat, 4);
  const start = performance.now();
  const result = await work();
  const total = performance.now() - start;
  beating = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  stall = Math.max(stall, performance.now() - last);
  return { result, stall, total };
}

const firstDifference = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};

describe("the HDR AVIF worker in Chromium", () => {
  it("writes the page's file from the plugin folder, and the page doesn't stall", async () => {
    const before = frames();
    const page = await longestStall(() => encodeAvif10(hdrToPq10(before.sdr, before.gain, 2), W, H, 80, loaders));

    const client = avifWorkerClient(spawnAvifWorker);
    const { sdr, gain } = frames();
    const worker = await longestStall(() => client.encode(sdr, gain, 2, 80));
    client.stop();

    const mp = ((W * H) / 1e6).toFixed(1);
    console.log(
      `[hdr-browser] ${mp} MP HDR AVIF: on the page, longest stall ${page.stall.toFixed(0)} ms of ${page.total.toFixed(0)} ms; ` +
        `in the worker, ${worker.stall.toFixed(0)} ms of ${worker.total.toFixed(0)} ms`,
    );
    expect(firstDifference(worker.result, page.result)).toBe(-1);
    // Transferred, not copied: the page's frames are empty now.
    expect([sdr.data.byteLength, gain.data.byteLength]).toEqual([0, 0]);
    // The page's own encode is the control: the heartbeat does see a stall.
    expect(page.stall).toBeGreaterThan(250);
    expect(worker.stall).toBeLessThan(100);
  });

  // A module worker that can't load fires a plain error event; the export
  // must hear about it rather than wait.
  it("rejects when the worker file can't be loaded", async () => {
    const client = avifWorkerClient(
      () => new Worker(`${location.origin}/__plugins__/hdr-editing/dist/no-such-worker.js`, { type: "module" }),
    );
    const { sdr, gain } = frames();
    await expect(client.encode(sdr, gain, 2, 80)).rejects.toThrow(/^the AVIF worker stopped/);
  });
});
