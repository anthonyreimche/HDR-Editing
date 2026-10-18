// One HDR AVIF encode, as the worker (avif-worker.ts) runs it: the PQ
// rendition of an SDR frame and its gain map (pq.ts), then the 10-bit encode
// (avif.ts), which keeps its compiled module in the worker between jobs.

import { encodeAvif10, type AvifLoaders } from "./avif";
import type { FrameSample } from "./frame";
import { hdrToPq10 } from "./pq";

export interface AvifJob {
  id: number;
  sdr: FrameSample;
  gain: FrameSample;
  headroom: number;
  quality: number;
}

export type AvifReply = { id: number; avif: Uint8Array } | { id: number; error: string };

/** The worker's global scope, as far as serving jobs goes. */
export interface AvifWorkerScope {
  onmessage: ((event: MessageEvent<AvifJob>) => void) | null;
  postMessage(message: AvifReply, transfer: Transferable[]): void;
}

/** A job's file, or why there is none: a failure is an answer, never a throw,
 *  so the page always hears back about the job it sent. */
export async function runAvifJob(job: AvifJob, loaders: AvifLoaders): Promise<AvifReply> {
  try {
    const { sdr, gain } = job;
    const avif = await encodeAvif10(hdrToPq10(sdr, gain, job.headroom), sdr.width, sdr.height, job.quality, loaders);
    return { id: job.id, avif };
  } catch (err) {
    return { id: job.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Answers each job posted to `scope`, moving the file's buffer to the page. */
export function serveAvifJobs(scope: AvifWorkerScope, loaders: AvifLoaders): void {
  scope.onmessage = ({ data }) => {
    void runAvifJob(data, loaders).then((reply) =>
      scope.postMessage(reply, "avif" in reply && reply.avif.buffer instanceof ArrayBuffer ? [reply.avif.buffer] : []),
    );
  };
}
