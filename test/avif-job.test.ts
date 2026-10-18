import { afterEach, describe, expect, it } from "vitest";
import { encodeAvif10, resetAvifEncoder, type AvifLoaders } from "../src/avif";
import { readNclx } from "../src/avif-box";
import { runAvifJob, serveAvifJobs, type AvifJob, type AvifReply, type AvifWorkerScope } from "../src/avif-job";
import type { FrameSample } from "../src/frame";
import { hdrToPq10 } from "../src/pq";
import { nodeAvifLoaders as loaders } from "./support/node-avif";

function gradient(w: number, h: number, blue: number): FrameSample {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([Math.round((x / (w - 1)) * 255), Math.round((y / (h - 1)) * 255), blue, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}

const job = (over: Partial<AvifJob> = {}): AvifJob => ({
  id: 7,
  sdr: gradient(32, 24, 90),
  gain: gradient(32, 24, 0),
  headroom: 2,
  quality: 80,
  ...over,
});

const offline: AvifLoaders = {
  factory: loaders.factory,
  wasm: async () => {
    throw new Error("offline");
  },
};

describe("an HDR AVIF job", () => {
  afterEach(() => resetAvifEncoder());

  // The worker runs what the export processor ran on the main thread: the
  // same frames give the same bytes.
  it("encodes the frames' PQ rendition, marked BT.2020 PQ, byte for byte as before", async () => {
    const { sdr, gain } = job();
    const before = await encodeAvif10(hdrToPq10(sdr, gain, 2), 32, 24, 80, loaders);
    const reply = await runAvifJob(job(), loaders);
    expect(reply).toEqual({ id: 7, avif: before });
    if (!("avif" in reply)) throw new Error("no file");
    expect(readNclx(reply.avif)).toMatchObject({ primaries: 9, transfer: 16 });
  }, 60_000);

  it("passes the quality and headroom through", async () => {
    const a = await runAvifJob(job({ quality: 30 }), loaders);
    const b = await runAvifJob(job({ quality: 90 }), loaders);
    const lifted = await runAvifJob(job({ headroom: 4 }), loaders);
    const plain = await runAvifJob(job({ headroom: 1 }), loaders);
    const bytes = (r: AvifReply) => ("avif" in r ? r.avif : new Uint8Array());
    expect(bytes(a).length).toBeLessThan(bytes(b).length);
    expect(bytes(lifted)).not.toEqual(bytes(plain));
  }, 60_000);

  it("hands back a file that owns its buffer, so transferring it moves the file alone", async () => {
    const reply = await runAvifJob(job(), loaders);
    if (!("avif" in reply)) throw new Error("no file");
    expect(reply.avif.byteOffset).toBe(0);
    expect(reply.avif.byteLength).toBe(reply.avif.buffer.byteLength);
  }, 60_000);

  it("replies with the error for a gain map of another size, rather than throwing", async () => {
    const reply = await runAvifJob(job({ id: 3, gain: gradient(16, 12, 0) }), loaders);
    expect(reply).toEqual({ id: 3, error: "[hdr-editing] the gain map is 16x12, the image 32x24" });
  });

  it("replies with the error when the encoder can't load", async () => {
    expect(await runAvifJob(job({ id: 4 }), offline)).toEqual({ id: 4, error: "offline" });
  });
});

describe("serveAvifJobs", () => {
  afterEach(() => resetAvifEncoder());

  function scope() {
    const posted: { message: AvifReply; transfer: Transferable[] }[] = [];
    const s: AvifWorkerScope = {
      onmessage: null,
      postMessage: (message, transfer) => void posted.push({ message, transfer }),
    };
    const settled = () =>
      new Promise<void>((resolve) => {
        const wait = () => (posted.length > 0 ? resolve() : setTimeout(wait, 5));
        wait();
      });
    return { s, posted, settled };
  }

  it("answers each job with its file, transferring the file's buffer", async () => {
    const { s, posted, settled } = scope();
    serveAvifJobs(s, loaders);
    s.onmessage?.({ data: job({ id: 11 }) } as MessageEvent<AvifJob>);
    await settled();
    const [{ message, transfer }] = posted;
    if (!("avif" in message)) throw new Error(message.error);
    expect(message.id).toBe(11);
    expect(transfer).toEqual([message.avif.buffer]);
  }, 60_000);

  it("answers a failed job with its error and transfers nothing", async () => {
    const { s, posted, settled } = scope();
    serveAvifJobs(s, offline);
    s.onmessage?.({ data: job({ id: 12 }) } as MessageEvent<AvifJob>);
    await settled();
    expect(posted).toEqual([{ message: { id: 12, error: "offline" }, transfer: [] }]);
  });
});
