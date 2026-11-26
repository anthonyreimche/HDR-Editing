import { describe, expect, it, vi } from "vitest";
import { createFallbackBoard, describeFallbacks } from "../src/export";
import type { NoticeHandle, NoticeOptions } from "../src/safelight";

describe("describeFallbacks", () => {
  it("names the photo and says what happened to it", () => {
    expect(describeFallbacks([{ label: "IMG_1.jpg", problem: "was exported without HDR: the AVIF worker stopped: boom" }])).toBe(
      "IMG_1.jpg was exported without HDR: the AVIF worker stopped: boom",
    );
  });

  it("counts several and gives the first", () => {
    const text = describeFallbacks([
      { label: "IMG_1.jpg", problem: "was exported without HDR: wasm missing" },
      { label: "IMG_2.jpg", problem: "was exported without HDR: wasm missing" },
      { label: "IMG_3.jpg", problem: "lost its metadata: no room for it" },
    ]);
    expect(text).toBe("3 photos didn't export as asked. First: IMG_1.jpg was exported without HDR: wasm missing");
  });
});

/** Core's notify, recording each notice and whether it was closed. */
function notices() {
  const shown: { options: NoticeOptions; closed: boolean }[] = [];
  const notify = vi.fn((options: NoticeOptions): NoticeHandle => {
    const entry = { options, closed: false };
    shown.push(entry);
    return { update: () => undefined, close: () => void (entry.closed = true) };
  });
  return { shown, notify };
}

describe("createFallbackBoard", () => {
  it("shows the running tally as one warning notice, as photos of one export fall back", () => {
    const { shown, notify } = notices();
    const board = createFallbackBoard(notify, () => 1000);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    board.add("IMG_2.jpg", "was exported without HDR: b");
    expect(shown).toEqual([
      { options: { message: "IMG_1.jpg was exported without HDR: a", tone: "warning" }, closed: true },
      { options: { message: "2 photos didn't export as asked. First: IMG_1.jpg was exported without HDR: a", tone: "warning" }, closed: false },
    ]);
  });

  it("starts a new tally for an export that begins well after the last one", () => {
    const { shown, notify } = notices();
    let now = 0;
    const board = createFallbackBoard(notify, () => now);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    now = 10 * 60_000;
    board.add("IMG_9.jpg", "was exported without HDR: b");
    expect(shown[shown.length - 1].options.message).toBe("IMG_9.jpg was exported without HDR: b");
  });

  it("takes its notice down and forgets its tally when cleared", () => {
    const { shown, notify } = notices();
    const board = createFallbackBoard(notify, () => 0);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    board.clear();
    expect(shown[0].closed).toBe(true);
    board.add("IMG_2.jpg", "was exported without HDR: b");
    expect(shown[shown.length - 1].options.message).toBe("IMG_2.jpg was exported without HDR: b");
  });
});
