import { describe, expect, it, vi } from "vitest";
import { createFallbackBoard, describeFallbacks } from "../src/notice";

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

describe("createFallbackBoard", () => {
  it("shows the running tally as photos of one export fall back", () => {
    const show = vi.fn();
    const board = createFallbackBoard(show, () => 1000);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    board.add("IMG_2.jpg", "was exported without HDR: b");
    expect(show).toHaveBeenNthCalledWith(1, "IMG_1.jpg was exported without HDR: a");
    expect(show).toHaveBeenNthCalledWith(2, "2 photos didn't export as asked. First: IMG_1.jpg was exported without HDR: a");
  });

  it("starts a new tally for an export that begins well after the last one", () => {
    const show = vi.fn();
    let now = 0;
    const board = createFallbackBoard(show, () => now);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    now = 10 * 60_000;
    board.add("IMG_9.jpg", "was exported without HDR: b");
    expect(show).toHaveBeenLastCalledWith("IMG_9.jpg was exported without HDR: b");
  });

  it("forgets its tally when cleared", () => {
    const show = vi.fn();
    const board = createFallbackBoard(show, () => 0);
    board.add("IMG_1.jpg", "was exported without HDR: a");
    board.clear();
    board.add("IMG_2.jpg", "was exported without HDR: b");
    expect(show).toHaveBeenLastCalledWith("IMG_2.jpg was exported without HDR: b");
  });
});
