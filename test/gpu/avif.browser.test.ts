// The HDR AVIF gate: Chromium must decode our file with the PQ transfer.
// Left half: SDR mid grey, no lift. Right half: SDR white lifted 2 stops
// (about 820 cd/m²). Drawn into an SDR canvas, a PQ-aware decode brings the
// right half to (or near) white; the same codes read as sRGB (the unpatched
// encode) come out at 186. That difference proves the colour description we
// write (the nclx box and the AV1 sequence header) is honoured. The halves
// are grey, so the primaries aren't tested here.

import { describe, expect, it } from "vitest";
import wasmUrl from "@hdr-modules/@jsquash/avif/codec/enc/avif_enc.wasm?url";
import { encodeAvif10, encodeAvif10Raw, type AvifFactory, type AvifLoaders } from "@hdr/avif";
import { readNclx } from "@hdr/avif-box";
import type { FrameSample } from "@hdr/frame";
import { hdrToPq10 } from "@hdr/pq";

const loaders: AvifLoaders = {
  factory: async () =>
    ((await import("@hdr-modules/@jsquash/avif/codec/enc/avif_enc.js")) as { default: AvifFactory }).default,
  wasm: async () => (await fetch(wasmUrl)).arrayBuffer(),
};

const W = 64;
const H = 32;
function halves(left: number, right: number): FrameSample {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = i % W < W / 2 ? left : right;
    data.set([v, v, v, 255], i * 4);
  }
  return { data, width: W, height: H };
}

// Built per encode: the encoder takes the pixels' whole buffer, and both
// encodes must start from identical input.
const pq10 = () => hdrToPq10(halves(118, 255), halves(0, 255), 2);

async function decoded(bytes: Uint8Array) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/avif" }));
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, W, H).data;
}

describe("HDR AVIF in Chromium", () => {
  it("reads the patched file with the PQ transfer", async () => {
    const avif = await encodeAvif10(pq10(), W, H, 90, loaders);
    // The control is the same pixels left as jSquash writes them (primaries 2,
    // transfer 2: sRGB-like), so the comparison isolates the colour description.
    const unpatched = await encodeAvif10Raw(pq10(), W, H, 90, loaders);
    expect(readNclx(avif)).toMatchObject({ primaries: 9, transfer: 16 });
    expect(readNclx(unpatched)).toMatchObject({ primaries: 2, transfer: 2 });
    const good = await decoded(avif);
    const bad = await decoded(unpatched);
    const at = (d: Uint8ClampedArray, x: number) => d[((H / 2) * W + x) * 4];
    console.log(`[hdr-browser] PQ AVIF: grey ${at(good, 16)}, lifted white ${at(good, 48)}; read as sRGB: ${at(bad, 48)}`);
    expect(at(good, 48)).toBeGreaterThanOrEqual(230);
    expect(at(bad, 48)).toBeLessThan(200);
    expect(at(good, 16)).toBeGreaterThan(70);
    expect(at(good, 16)).toBeLessThan(170);
  });
});
