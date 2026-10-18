// The SDR frame and the gain-map frame of the live view, captured as a pair
// (the gain map through GAIN_MAP_PATCH, so the live view never sees it), with
// what they were rendered with. One pair in flight; requests that arrive
// meanwhile collapse into one more run with the latest view nonce. The
// consumer owns a published pair's bitmaps.

import { GAIN_MAP_PATCH } from "./params";

/** What a pair's captures render with, read in the turn they start: the
 *  pair is decoded and placed by it, not by the edit as it is when it lands. */
export interface PairBasis {
  /** The headroom the gain map was encoded with. */
  headroom: number;
  /** The geometry the frames were rendered with (geometryOf). */
  geometry: string;
}

export interface FramePair extends PairBasis {
  sdr: ImageBitmap;
  gain: ImageBitmap;
  /** The view (useDevelopOverlay().nonce) the pair was captured for. */
  nonce: number;
}

export interface PairSource {
  /** Read from the same develop state the captures render. */
  basis(): PairBasis;
  capture(paramBag?: Record<string, unknown>): Promise<ImageBitmap>;
}

export interface PairScheduler {
  request(nonce: number): void;
  stop(): void;
}

export function createPairScheduler(
  source: PairSource,
  publish: (pair: FramePair | null) => void,
): PairScheduler {
  let busy = false;
  let pending: number | null = null;
  let stopped = false;

  // A capture that throws before returning a promise must not strand the
  // other one's bitmap, so it becomes a rejection like any other failure.
  const start = (paramBag?: Record<string, unknown>): Promise<ImageBitmap> => {
    try {
      return source.capture(paramBag);
    } catch (err) {
      return Promise.reject(err);
    }
  };

  // Both captures are asked for in the same synchronous turn as the basis is
  // read: the source reads the develop state when it is called, so asking one
  // after the other could pair an SDR frame from one edit with a gain map, a
  // headroom or a geometry from the next. A basis that throws starts no capture.
  const capturePair = async (nonce: number): Promise<FramePair | null> => {
    const basis = source.basis();
    const [sdr, gain] = await Promise.allSettled([start(), start({ ...GAIN_MAP_PATCH })]);
    const a = sdr.status === "fulfilled" ? sdr.value : null;
    const b = gain.status === "fulfilled" ? gain.value : null;
    if (a && b && a.width >= 2 && a.width === b.width && a.height === b.height) {
      return { ...basis, sdr: a, gain: b, nonce };
    }
    a?.close();
    b?.close();
    return null;
  };

  const run = async (nonce: number): Promise<void> => {
    busy = true;
    try {
      const pair = await capturePair(nonce);
      if (stopped) {
        pair?.sdr.close();
        pair?.gain.close();
        return;
      }
      publish(pair);
    } catch (err) {
      // A consumer that throws must not stop the queued request from running.
      console.warn("[hdr-editing] A frame pair could not be published.", err);
    } finally {
      busy = false;
      if (pending !== null) {
        const next = pending;
        pending = null;
        void run(next);
      }
    }
  };

  return {
    request(nonce) {
      if (stopped) return;
      if (busy) {
        pending = nonce;
        return;
      }
      void run(nonce);
    },
    stop() {
      stopped = true;
      pending = null;
    },
  };
}
