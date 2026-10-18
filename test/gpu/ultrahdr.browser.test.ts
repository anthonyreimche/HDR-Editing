// Chromium decodes what the extension writes: a one-component gain-map JPEG
// from our encoder, and an assembled Ultra HDR file (to its SDR base, on an
// SDR display, as here).

import { describe, expect, it } from "vitest";
import { encodeGreyJpeg } from "@hdr/jpeg-encode";
import { assembleUltraHdr } from "@hdr/ultrahdr";

async function pixels(bytes: Uint8Array, type = "image/jpeg") {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

function gradient(w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round((255 * (x + y)) / (w + h - 2));
  return g;
}

describe("Chromium and our JPEGs", () => {
  it("decodes a one-component JPEG to its input within JPEG error", async () => {
    const grey = gradient(64, 48);
    const px = await pixels(encodeGreyJpeg(grey, 64, 48, 90));
    let se = 0;
    for (let i = 0; i < grey.length; i++) se += (grey[i] - px.data[i * 4]) ** 2;
    const psnr = 10 * Math.log10((255 * 255) / (se / grey.length));
    console.log(`[hdr-browser] grey JPEG PSNR ${psnr.toFixed(1)} dB`);
    expect(psnr).toBeGreaterThan(40);
  });

  // A container check: on an SDR display the base decodes whether or not the
  // gain map is found, so this proves the assembled layout is read and the
  // base isn't displaced; finding the map is the node suite's MPF/XMP checks.
  it("decodes an Ultra HDR file to its SDR base", async () => {
    const base = encodeGreyJpeg(gradient(64, 48), 64, 48, 90);
    const map = encodeGreyJpeg(new Uint8Array(64 * 48).fill(200), 64, 48, 90);
    const [file, plain] = [await pixels(assembleUltraHdr(base, map, 2)), await pixels(base)];
    expect([file.width, file.height]).toEqual([64, 48]);
    let worst = 0;
    for (let i = 0; i < plain.data.length; i++) worst = Math.max(worst, Math.abs(file.data[i] - plain.data[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });
});
