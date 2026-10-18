import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvifJob, AvifReply } from "../src/avif-job";
import { avifWorkerClient, spawnAvifWorker, type AvifWorkerLike } from "../src/avif-worker-client";
import type { FrameSample } from "../src/frame";

afterEach(() => vi.unstubAllGlobals());

class FakeWorker implements AvifWorkerLike {
  onmessage: ((event: MessageEvent<AvifReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: { message: AvifJob; transfer: Transferable[] }[] = [];
  terminated = false;
  postMessage(message: AvifJob, transfer: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(data: AvifReply): void {
    this.onmessage?.({ data } as MessageEvent<AvifReply>);
  }
  crash(message?: string): { defaultPrevented: boolean } {
    const event = { message, defaultPrevented: false, preventDefault: () => void (event.defaultPrevented = true) };
    this.onerror?.(event as unknown as ErrorEvent);
    return event;
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const spawn = vi.fn(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client: avifWorkerClient(spawn), workers, spawn };
}

const frame = (w: number, h: number): FrameSample => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const FILE = Uint8Array.of(1, 2, 3);

describe("the AVIF worker client", () => {
  it("posts the frames to the worker, transferring their buffers, and resolves with the file it answers", async () => {
    const { client, workers } = harness();
    const sdr = frame(4, 2);
    const gain = frame(4, 2);
    const done = client.encode(sdr, gain, 2.5, 70);
    const [{ message, transfer }] = workers[0].posted;
    expect(message).toEqual({ id: message.id, sdr, gain, headroom: 2.5, quality: 70 });
    expect(transfer).toEqual([sdr.data.buffer, gain.data.buffer]);
    workers[0].answer({ id: message.id, avif: FILE });
    expect(await done).toBe(FILE);
  });

  it("starts one worker and keeps it for later encodes", async () => {
    const { client, workers, spawn } = harness();
    const first = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].answer({ id: workers[0].posted[0].message.id, avif: FILE });
    await first;
    const second = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].answer({ id: workers[0].posted[1].message.id, avif: FILE });
    await second;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0].terminated).toBe(false);
  });

  it("matches each answer to its encode", async () => {
    const { client, workers } = harness();
    const a = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    const b = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    const [ja, jb] = workers[0].posted.map((p) => p.message.id);
    expect(ja).not.toBe(jb);
    workers[0].answer({ id: jb, avif: Uint8Array.of(2) });
    workers[0].answer({ id: ja, avif: Uint8Array.of(1) });
    expect([await a, await b]).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
  });

  it("rejects with the job's error, and keeps the worker", async () => {
    const { client, workers, spawn } = harness();
    const done = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].answer({ id: workers[0].posted[0].message.id, error: "[hdr-editing] AVIF encoding failed" });
    await expect(done).rejects.toThrow("[hdr-editing] AVIF encoding failed");
    void client.encode(frame(2, 2), frame(2, 2), 2, 80);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0].terminated).toBe(false);
  });

  it("rejects every pending encode when the worker fails, and starts a new worker for the next", async () => {
    const { client, workers, spawn } = harness();
    const a = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    const b = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].crash("Uncaught RangeError: Array buffer allocation failed");
    await expect(a).rejects.toThrow("the AVIF worker stopped: Uncaught RangeError: Array buffer allocation failed");
    await expect(b).rejects.toThrow("the AVIF worker stopped");
    expect(workers[0].terminated).toBe(true);
    void client.encode(frame(2, 2), frame(2, 2), 2, 80);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1].posted).toHaveLength(1);
  });

  // A module worker that can't load (a missing file, a CSP refusal) fires a
  // plain error event, with no message.
  it("says the worker stopped when it fails without a message", async () => {
    const { client, workers } = harness();
    const done = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].crash();
    await expect(done).rejects.toThrow(/^the AVIF worker stopped$/);
  });

  // The processor's fallback warning is the one report of a failed export.
  it("keeps the worker's error from also being reported as uncaught", () => {
    const { client, workers } = harness();
    void client.encode(frame(2, 2), frame(2, 2), 2, 80).catch(() => undefined);
    expect(workers[0].crash("boom").defaultPrevented).toBe(true);
  });

  it("fails the same way when an answer can't be read", async () => {
    const { client, workers, spawn } = harness();
    const done = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].onmessageerror?.({} as MessageEvent);
    await expect(done).rejects.toThrow("the AVIF worker stopped");
    expect(workers[0].terminated).toBe(true);
    void client.encode(frame(2, 2), frame(2, 2), 2, 80);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("rejects when the worker can't start, and tries again next time", async () => {
    let calls = 0;
    const client = avifWorkerClient(() => {
      if (calls++ === 0) throw new Error("SecurityError");
      return new FakeWorker();
    });
    await expect(client.encode(frame(2, 2), frame(2, 2), 2, 80)).rejects.toThrow("SecurityError");
    void client.encode(frame(2, 2), frame(2, 2), 2, 80);
    expect(calls).toBe(2);
  });

  it("rejects when the frames can't be posted", async () => {
    const { client, workers } = harness();
    const done = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    workers[0].answer({ id: workers[0].posted[0].message.id, avif: FILE });
    await done;
    workers[0].postMessage = () => {
      throw new Error("DataCloneError");
    };
    await expect(client.encode(frame(2, 2), frame(2, 2), 2, 80)).rejects.toThrow("DataCloneError");
  });

  it("stop ends the worker and rejects what is pending; the next encode starts a new one", async () => {
    const { client, workers, spawn } = harness();
    const done = client.encode(frame(2, 2), frame(2, 2), 2, 80);
    client.stop();
    await expect(done).rejects.toThrow("the AVIF worker stopped");
    expect(workers[0].terminated).toBe(true);
    void client.encode(frame(2, 2), frame(2, 2), 2, 80);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("starts no worker just to stop it", () => {
    const { client, spawn } = harness();
    client.stop();
    expect(spawn).not.toHaveBeenCalled();
  });
});

// The installed build is the one place import.meta.url is undefined, so the
// worker is reached through the plugin's served path, as the wasm is.
describe("spawnAvifWorker", () => {
  it("loads the worker as a module from the plugin's dist folder, versioned", () => {
    vi.stubGlobal("location", { origin: "app://safelight" });
    const made: { url: string; options: WorkerOptions }[] = [];
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        constructor(url: string, options: WorkerOptions) {
          super();
          made.push({ url, options });
        }
      },
    );
    spawnAvifWorker();
    expect(made).toHaveLength(1);
    expect(made[0].url).toMatch(/^app:\/\/safelight\/__plugins__\/hdr-editing\/dist\/avif-worker\.js\?v=\d+\.\d+\.\d+$/);
    expect(made[0].options).toEqual({ type: "module" });
  });
});
