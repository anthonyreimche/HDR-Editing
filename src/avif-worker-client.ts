// HDR AVIF encodes run in a module worker (dist/avif-worker.js, built from
// avif-worker.ts): the PQ conversion and the encode take seconds for a typical
// photo and tens of seconds for a large one at full size, time Safelight would
// otherwise spend unresponsive. One worker serves every export and keeps the
// compiled encoder between them. The frames' buffers move to it and the file's
// buffer moves back, so nothing is copied. A worker that fails is dropped with
// whatever it had pending, and the next encode starts a new one.

import { assetUrl } from "./asset-url";
import type { AvifJob, AvifReply } from "./avif-job";
import type { FrameSample } from "./frame";

/** What the client uses of a Worker. */
export interface AvifWorkerLike {
  onmessage: ((event: MessageEvent<AvifReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: AvifJob, transfer: Transferable[]): void;
  terminate(): void;
}

export interface AvifWorkerClient {
  /** The frames' HDR rendition as a 10-bit PQ AVIF, marked BT.2020 PQ. The
   *  frames' buffers are transferred, so their data is empty afterwards. */
  encode(sdr: FrameSample, gain: FrameSample, headroom: number, quality: number): Promise<Uint8Array>;
  /** Ends the worker and rejects any encode in progress. */
  stop(): void;
}

/** Loaded through the plugin's served path, as the encoder's files are:
 *  import.meta.url is undefined in installed bundles. */
export function spawnAvifWorker(): AvifWorkerLike {
  return new Worker(assetUrl("dist/avif-worker.js"), { type: "module" });
}

/** A SharedArrayBuffer can't be transferred; posting shares it instead. */
const transferable = (...frames: FrameSample[]): ArrayBuffer[] =>
  frames.map((f) => f.data.buffer).filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);

export function avifWorkerClient(spawn: () => AvifWorkerLike): AvifWorkerClient {
  let worker: AvifWorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve(avif: Uint8Array): void; reject(err: Error): void }>();

  function drop(reason?: string): void {
    worker?.terminate();
    worker = null;
    const err = new Error(reason ? `the AVIF worker stopped: ${reason}` : "the AVIF worker stopped");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  function start(): AvifWorkerLike {
    const w = spawn();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if ("avif" in data) p.resolve(data.avif);
      else p.reject(new Error(data.error));
    };
    // A module worker that can't load (a missing file, a CSP refusal) fires a
    // plain error event, without a message. Either way the processor's
    // fallback warning reports it, so the browser doesn't log it as uncaught.
    w.onerror = (event) => {
      event.preventDefault();
      if (worker === w) drop(event.message);
    };
    w.onmessageerror = () => {
      if (worker === w) drop("an answer couldn't be read");
    };
    return w;
  }

  return {
    encode: (sdr, gain, headroom, quality) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        try {
          worker ??= start();
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, sdr, gain, headroom, quality }, transferable(sdr, gain));
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      }),
    stop: () => drop(),
  };
}

export const avifWorker = avifWorkerClient(spawnAvifWorker);
