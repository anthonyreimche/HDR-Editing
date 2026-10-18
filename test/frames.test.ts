import { afterEach, describe, expect, it, vi } from "vitest";
import { createPairScheduler, type FramePair, type PairBasis } from "../src/frames";
import { GAIN_MAP_PATCH } from "../src/params";

type Closable = ImageBitmap & { close: ReturnType<typeof vi.fn> };

function bitmap(width = 8, height = 6) {
  return { width, height, close: vi.fn() } as unknown as Closable;
}

const BASIS: PairBasis = { headroom: 2, geometry: "g" };

/** A capture whose answers the test hands out one at a time. */
function controlled(basis: () => PairBasis = () => BASIS) {
  const calls: { bag?: Record<string, unknown>; resolve(b: ImageBitmap): void; reject(e: Error): void }[] = [];
  const source = {
    basis,
    capture: (bag?: Record<string, unknown>) =>
      new Promise<ImageBitmap>((resolve, reject) => calls.push({ bag, resolve, reject })),
  };
  return { source, calls };
}

/** Answers both captures of the oldest unanswered pair. */
function answerPair(calls: ReturnType<typeof controlled>["calls"], from: number) {
  const sdr = bitmap();
  const gain = bitmap();
  calls[from].resolve(sdr);
  calls[from + 1].resolve(gain);
  return { sdr, gain };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe("createPairScheduler", () => {
  it("starts the SDR and gain captures in the same turn and publishes them with the nonce", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(3);
    // Nothing has been awaited yet: a second, later call could see a newer edit.
    expect(calls).toHaveLength(2);
    expect(calls[0].bag).toBeUndefined();
    expect(calls[1].bag).toEqual(GAIN_MAP_PATCH);
    answerPair(calls, 0);
    await tick();
    expect(published).toHaveLength(1);
    expect(published[0]!.nonce).toBe(3);
  });

  it("records what the captures render with, read in the turn they start, not when they land", async () => {
    let headroom = 2;
    const reads: number[] = [];
    const { source, calls } = controlled(() => {
      reads.push(calls.length);
      return { headroom, geometry: `straighten ${headroom}` };
    });
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    // Read once, before either capture starts; both start in that turn.
    expect(reads).toEqual([0]);
    expect(calls).toHaveLength(2);
    headroom = 3; // the slider moves while the pair renders
    answerPair(calls, 0);
    await tick();
    expect(published[0]).toMatchObject({ nonce: 1, headroom: 2, geometry: "straighten 2" });
  });

  it("starts no capture when reading what they render with throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { source, calls } = controlled(() => {
      throw new Error("store gone");
    });
    const publish = vi.fn();
    const s = createPairScheduler(source, publish);
    s.request(1);
    await tick();
    expect(calls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never pairs an SDR frame from one edit with a gain frame from another", async () => {
    // Each frame carries the edit that was current when its capture was asked for.
    let edit = "A";
    const pending: { resolve(): void }[] = [];
    const source = {
      basis: () => BASIS,
      capture: () => {
        const tag = edit;
        return new Promise<ImageBitmap>((resolve) =>
          pending.push({ resolve: () => resolve({ width: 8, height: 6, close() {}, edit: tag } as unknown as ImageBitmap) }),
        );
      },
    };
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    pending[0].resolve();
    edit = "B"; // an edit lands while the first answer is in
    await tick();
    for (const p of pending.slice(1)) p.resolve();
    await tick();
    const pair = published[0]!;
    expect((pair.sdr as unknown as { edit: string }).edit).toBe("A");
    expect((pair.gain as unknown as { edit: string }).edit).toBe("A");
  });

  it("keeps one pair in flight and runs once more for the latest request", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    s.request(2);
    s.request(3);
    expect(calls).toHaveLength(2);
    answerPair(calls, 0);
    await tick();
    expect(published.map((p) => p?.nonce)).toEqual([1]);
    expect(calls).toHaveLength(4);
    answerPair(calls, 2);
    await tick();
    expect(published.map((p) => p?.nonce)).toEqual([1, 3]);
    expect(calls).toHaveLength(4);
  });

  it("publishes null and closes what it got when the gain capture fails", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    const sdr = bitmap();
    calls[0].resolve(sdr);
    calls[1].reject(new Error("gone"));
    await tick();
    expect(published).toEqual([null]);
    expect(sdr.close).toHaveBeenCalled();
  });

  it("closes the SDR frame when the gain capture throws before returning a promise", async () => {
    const sdr = bitmap();
    let call = 0;
    const source = {
      basis: () => BASIS,
      capture: (): Promise<ImageBitmap> => {
        call++;
        if (call === 2) throw new Error("worker gone");
        return Promise.resolve(sdr);
      },
    };
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    await tick();
    expect(published).toEqual([null]);
    expect(sdr.close).toHaveBeenCalledTimes(1);
  });

  it("publishes null and closes what it got when the SDR capture fails", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    const gain = bitmap();
    calls[0].reject(new Error("gone"));
    calls[1].resolve(gain);
    await tick();
    expect(published).toEqual([null]);
    expect(gain.close).toHaveBeenCalled();
  });

  it("closes both bitmaps of a blank pair", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    const blank = bitmap(1, 1);
    const gain = bitmap();
    calls[0].resolve(blank);
    calls[1].resolve(gain);
    await tick();
    expect(published).toEqual([null]);
    expect(blank.close).toHaveBeenCalled();
    expect(gain.close).toHaveBeenCalled();
  });

  it("closes both bitmaps of a pair whose sizes differ", async () => {
    const { source, calls } = controlled();
    const published: (FramePair | null)[] = [];
    const s = createPairScheduler(source, (p) => published.push(p));
    s.request(1);
    const sdr = bitmap(8, 6);
    const gain = bitmap(4, 3);
    calls[0].resolve(sdr);
    calls[1].resolve(gain);
    await tick();
    expect(published).toEqual([null]);
    expect(sdr.close).toHaveBeenCalled();
    expect(gain.close).toHaveBeenCalled();
  });

  it("drops a pair that lands after stop, closing both bitmaps", async () => {
    const { source, calls } = controlled();
    const publish = vi.fn();
    const s = createPairScheduler(source, publish);
    s.request(1);
    s.stop();
    const { sdr, gain } = answerPair(calls, 0);
    await tick();
    expect(publish).not.toHaveBeenCalled();
    expect(sdr.close).toHaveBeenCalled();
    expect(gain.close).toHaveBeenCalled();
  });

  it("forgets a queued request on stop and ignores later ones", async () => {
    const { source, calls } = controlled();
    const publish = vi.fn();
    const s = createPairScheduler(source, publish);
    s.request(1);
    s.request(2);
    s.stop();
    answerPair(calls, 0);
    await tick();
    s.request(3);
    expect(calls).toHaveLength(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("warns when publish throws and still runs the queued request, in order", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { source, calls } = controlled();
    const seen: number[] = [];
    let first = true;
    const s = createPairScheduler(source, (p) => {
      seen.push(p!.nonce);
      if (first) {
        first = false;
        throw new Error("consumer failed");
      }
    });
    s.request(1);
    s.request(2);
    answerPair(calls, 0);
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("[hdr-editing]");
    expect(seen).toEqual([1]);
    expect(calls).toHaveLength(4);
    answerPair(calls, 2);
    await tick();
    expect(seen).toEqual([1, 2]);
    // The scheduler is idle again: a new request starts straight away.
    s.request(3);
    expect(calls).toHaveLength(6);
  });
});
