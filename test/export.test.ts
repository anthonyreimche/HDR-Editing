import jpeg from "jpeg-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNclx } from "../src/avif-box";
import { readExif } from "../src/avif-exif";
import type { AvifJob, AvifReply } from "../src/avif-job";
import { avifWorker, type AvifWorkerLike } from "../src/avif-worker-client";
import { historyCursor, liveExportDeps, processExport, sameShape, type ExportDeps } from "../src/export";
import type { FrameSample } from "../src/frame";
import { encodeGreyJpeg } from "../src/jpeg-encode";
import { concat, parseJpeg, payloadOf, segment, startsWith } from "../src/jpeg";
import { GAIN_MAP_PATCH, KEY } from "../src/params";
import { initRuntime } from "../src/runtime";
import type { ExportProcessorContext, SafelightAPI } from "../src/safelight";
import { MPF_SIG } from "../src/ultrahdr";
import { avifForExif } from "./support/avif-exif-fixture";
import { avifLike } from "./support/avif-fixture";

const PHOTO = { id: "p1", exif: {} };
// The export's long-edge setting: the core's JPEG is 40 px wide, as the render.
const CTX: ExportProcessorContext = { longEdge: 40 };
// A core that tells the processor the export's settings (Safelight 3.2.0).
const SETTINGS = { format: "image/jpeg", quality: 0.5, longEdge: 40, colorSpace: "display-p3", sharpenAmount: 60, sharpenRadius: 1.2, includeMetadata: true, includeLocation: false } as const;
const CTX_SETTINGS: ExportProcessorContext = { longEdge: 40, settings: SETTINGS };
const sdrBytes = () => new Uint8Array(encodeGreyJpeg(new Uint8Array(40 * 30).fill(180), 40, 30, 90));
const sdrJpeg = () => new Blob([new Uint8Array(sdrBytes())], { type: "image/jpeg" });
const frame = (w: number, h: number, v: number): FrameSample => ({
  data: new Uint8ClampedArray(w * h * 4).fill(v),
  width: w,
  height: h,
});

type SpiedDeps = ExportDeps & {
  warn: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  renderGainMap: ReturnType<typeof vi.fn>;
  renderBase: ReturnType<typeof vi.fn>;
  decodeFile: ReturnType<typeof vi.fn>;
};

function deps(over: Partial<ExportDeps> = {}): SpiedDeps {
  return {
    edit: async () => ({ bag: { [KEY.on]: 1, [KEY.headroom]: 2 }, params: { processVersion: 2 } }),
    renderGainMap: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    renderBase: vi.fn(async () => new Blob(["base"], { type: "image/png" })),
    decode: async () => frame(40, 30, 128),
    decodeFile: vi.fn(async () => frame(40, 30, 200)),
    encodeAvif: async () => avifLike(),
    warn: vi.fn(),
    notify: vi.fn(),
    ...over,
  } as SpiedDeps;
}

/** The gain map JPEG inside an Ultra HDR file, found through its MPF index. */
function gainMapOf(bytes: Uint8Array): ReturnType<typeof jpeg.decode> {
  const mpf = parseJpeg(bytes).segments.find((s) => s.marker === 0xe2 && startsWith(payloadOf(bytes, s), MPF_SIG))!;
  const view = new DataView(bytes.buffer);
  const gainStart = view.getUint32(mpf.start + 8 + 50 + 4);
  return jpeg.decode(bytes.subarray(gainStart), { useTArray: true });
}

/** The encoder's shape, answering with a minimal AVIF. */
const encodeStub = async (_sdr: FrameSample, _gain: FrameSample, _headroom: number, _quality: number) => avifLike();

describe("processExport", () => {
  it("passes the file through when HDR output is off, HDR is off, or the photo is on older processing", async () => {
    const blob = sdrJpeg();
    expect(await processExport(blob, PHOTO, { output: "off" }, CTX, deps())).toBe(blob);
    expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, deps({ edit: async () => ({ bag: {}, params: { processVersion: 2 } }) }))).toBe(blob);
    expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, deps({ edit: async () => ({ bag: { [KEY.on]: 1 }, params: { processVersion: 1 } }) }))).toBe(blob);
    expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, deps({ edit: async () => null }))).toBe(blob);
  });

  it("renders nothing for a file it passes through", async () => {
    const blob = sdrJpeg();
    const off = deps();
    const noHdr = deps({ edit: async () => ({ bag: {}, params: { processVersion: 2 } }) });
    const older = deps({ edit: async () => ({ bag: { [KEY.on]: 1 }, params: { processVersion: 1 } }) });
    await processExport(blob, PHOTO, { output: "off" }, CTX, off);
    await processExport(blob, PHOTO, { output: "avif" }, CTX, noHdr);
    await processExport(blob, PHOTO, { output: "avif" }, CTX, older);
    expect([off.renderGainMap, noHdr.renderGainMap, older.renderGainMap].map((r) => r.mock.calls.length)).toEqual([0, 0, 0]);
    expect([off.notify, noHdr.notify, older.notify].map((n) => n.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it("falls back to the SDR file, saying why, when reading the edit fails", async () => {
    const blob = sdrJpeg();
    const d = deps({ edit: async () => { throw new Error("catalog offline"); } });
    expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, d)).toBe(blob);
    expect(d.warn).toHaveBeenCalledTimes(1);
    expect(d.warn.mock.calls[0][0]).toContain("catalog offline");
  });

  it("tells the user, not only the console, when it falls back to the SDR file", async () => {
    const blob = sdrJpeg();
    const d = deps({ edit: async () => { throw new Error("catalog offline"); } });
    await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("catalog offline"));
  });

  describe("Ultra HDR", () => {
    it("writes an Ultra HDR JPEG with the gain map rendered at the export's long edge", async () => {
      const d = deps();
      const out = await processExport(sdrJpeg(), PHOTO, { output: "ultrahdr" }, CTX, d);
      expect(out.type).toBe("image/jpeg");
      expect(d.renderGainMap).toHaveBeenCalledWith(PHOTO, 40);
      const map = gainMapOf(new Uint8Array(await out.arrayBuffer()));
      expect([map.width, map.height]).toEqual([40, 30]);
      expect(Math.abs(map.data[0] - 128)).toBeLessThanOrEqual(2);
    });

    it("asks for the original size when the export keeps it", async () => {
      const d = deps();
      await processExport(sdrJpeg(), PHOTO, { output: "ultrahdr" }, { longEdge: null }, d);
      expect(d.renderGainMap).toHaveBeenCalledWith(PHOTO, null);
    });

    it("leaves a non-JPEG export alone, saying why", async () => {
      const png = new Blob(["png"], { type: "image/png" });
      const d = deps();
      expect(await processExport(png, PHOTO, { output: "ultrahdr" }, CTX, d)).toBe(png);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("JPEG"));
    });

    it("assembles a gain map stored at half the image's scale", async () => {
      const d = deps({ decode: async () => frame(20, 15, 128) });
      const out = await processExport(sdrJpeg(), PHOTO, { output: "ultrahdr" }, CTX, d);
      expect(d.warn).not.toHaveBeenCalled();
      const map = gainMapOf(new Uint8Array(await out.arrayBuffer()));
      expect([map.width, map.height]).toEqual([20, 15]);
    });

    it("accepts a gain map within a pixel of the image's shape at its own scale, and no further", async () => {
      // The half-scale map of a 40x30 image is 20x15; 20x16 is a pixel taller.
      const near = deps({ decode: async () => frame(20, 16, 128) });
      expect((await processExport(sdrJpeg(), PHOTO, { output: "ultrahdr" }, CTX, near)).type).toBe("image/jpeg");
      expect(near.warn).not.toHaveBeenCalled();

      const blob = sdrJpeg();
      const far = deps({ decode: async () => frame(20, 17, 128) });
      expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, far)).toBe(blob);
      expect(far.warn).toHaveBeenCalledTimes(1);
      expect(far.notify).toHaveBeenCalledTimes(1);
    });

    it("allows a pixel of drift on both sides at once, but not another crop", () => {
      // The export and the nested render can come from different decodes of
      // the source (a cache entry written in between), each off by a pixel.
      expect(sameShape({ width: 3023, height: 1296 }, { width: 3022, height: 1297 })).toBe(true);
      expect(sameShape({ width: 1511, height: 649 }, { width: 3022, height: 1297 })).toBe(true);
      expect(sameShape({ width: 3030, height: 2000 }, { width: 3000, height: 2000 })).toBe(false);
      expect(sameShape({ width: 3000, height: 2010 }, { width: 3000, height: 2000 })).toBe(false);
    });

    it("falls back to the SDR file when the gain map has another aspect", async () => {
      const blob = sdrJpeg();
      const d = deps({ decode: async () => frame(40, 20, 128) });
      expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, d)).toBe(blob);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.warn.mock.calls[0][0]).toContain("gain map");
    });

    it("falls back to the SDR file when the gain map doesn't render", async () => {
      const blob = sdrJpeg();
      const d = deps({ renderGainMap: vi.fn(async () => null) });
      expect(await processExport(blob, PHOTO, { output: "ultrahdr" }, CTX, d)).toBe(blob);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.warn.mock.calls[0][0]).toContain("didn't render");
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("didn't render"));
    });
  });

  describe("HDR AVIF", () => {
    it("writes an HDR AVIF marked BT.2020 PQ from the delivered file and the gain render", async () => {
      const encodeAvif = vi.fn(encodeStub);
      const d = deps({ encodeAvif });
      const out = await processExport(sdrJpeg(), PHOTO, { output: "avif", avifQuality: 70 }, CTX, d);
      expect(out.type).toBe("image/avif");
      expect(readNclx(new Uint8Array(await out.arrayBuffer()))).toMatchObject({ primaries: 9, transfer: 16 });
      expect(d.renderGainMap).toHaveBeenCalledWith(PHOTO, 40);
      const [sdr, gain, headroom, quality] = encodeAvif.mock.calls[0];
      expect([sdr.width, sdr.height, gain.width, gain.height, headroom, quality]).toEqual([40, 30, 40, 30, 2, 70]);
    });

    // The delivered file already has the user's colour space, output sharpening
    // and size applied; a separate render would have had to guess them.
    it("builds the SDR image from the file the core delivered, not from another render", async () => {
      const blob = sdrJpeg();
      const sdrFrame = frame(40, 30, 200);
      const gainFrame = frame(40, 30, 50);
      const encodeAvif = vi.fn(encodeStub);
      const d = deps({ decodeFile: vi.fn(async () => sdrFrame), decode: async () => gainFrame, encodeAvif });
      await processExport(blob, PHOTO, { output: "avif" }, CTX, d);
      expect(d.decodeFile).toHaveBeenCalledWith(blob);
      expect(encodeAvif.mock.calls[0][0]).toBe(sdrFrame);
      expect(encodeAvif.mock.calls[0][1]).toBe(gainFrame);
    });

    describe("with the export's settings in the context", () => {
      // The delivered file has been through the export's lossy encoder; a
      // lossless render with the same size and sharpening has not.
      const lossless = new Blob(["base"], { type: "image/png" });
      const gainPng = new Blob(["gain"], { type: "image/png" });
      const baseFrame = frame(40, 30, 210);
      const gainFrame = frame(40, 30, 60);
      const byBlob = (blob: Blob) => (blob === lossless ? baseFrame : gainFrame);

      it("builds the SDR image from a lossless render with the export's settings, not the delivered file", async () => {
        const encodeAvif = vi.fn(encodeStub);
        const d = deps({
          renderBase: vi.fn(async () => lossless),
          renderGainMap: vi.fn(async () => gainPng),
          decode: async (png) => byBlob(png),
          encodeAvif,
        });
        const out = await processExport(sdrJpeg(), PHOTO, { output: "avif" }, CTX_SETTINGS, d);
        expect(out.type).toBe("image/avif");
        expect(d.renderBase).toHaveBeenCalledWith(PHOTO, SETTINGS);
        expect(d.decodeFile).not.toHaveBeenCalled();
        expect(encodeAvif.mock.calls[0][0]).toBe(baseFrame);
        expect(encodeAvif.mock.calls[0][1]).toBe(gainFrame);
        expect(d.warn).not.toHaveBeenCalled();
      });

      it("still takes the Exif block from the delivered file", async () => {
        const TIFF = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
        const base = sdrBytes();
        const exif = segment(0xe1, concat([Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0), TIFF]));
        const delivered = new Blob([new Uint8Array(concat([base.subarray(0, 2), exif, base.subarray(2)]))], { type: "image/jpeg" });
        const d = deps({ encodeAvif: async () => avifForExif() });
        const out = await processExport(delivered, PHOTO, { output: "avif" }, CTX_SETTINGS, d);
        expect(readExif(new Uint8Array(await out.arrayBuffer()))).toEqual({ tiff: TIFF, describes: 1 });
      });

      it("falls back to the SDR file, telling the user, when the lossless render doesn't come back", async () => {
        const blob = sdrJpeg();
        const d = deps({ renderBase: vi.fn(async () => null) });
        expect(await processExport(blob, PHOTO, { output: "avif" }, CTX_SETTINGS, d)).toBe(blob);
        expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("base image didn't render"));
      });

      it("leaves an export format AVIF can't build on alone, without rendering", async () => {
        const tiff = new Blob(["tiff"], { type: "image/tiff" });
        const d = deps();
        expect(await processExport(tiff, PHOTO, { output: "avif" }, CTX_SETTINGS, d)).toBe(tiff);
        expect(d.renderBase).not.toHaveBeenCalled();
      });

      it("uses the lossless render only for the AVIF, not for Ultra HDR", async () => {
        const d = deps();
        await processExport(sdrJpeg(), PHOTO, { output: "ultrahdr" }, CTX_SETTINGS, d);
        expect(d.renderBase).not.toHaveBeenCalled();
      });
    });

    it("builds from the delivered file when the core doesn't pass the export's settings", async () => {
      const d = deps();
      await processExport(sdrJpeg(), PHOTO, { output: "avif" }, CTX, d);
      expect(d.renderBase).not.toHaveBeenCalled();
      expect(d.decodeFile).toHaveBeenCalledTimes(1);
    });

    it("takes its size from the delivered file", async () => {
      const encodeAvif = vi.fn(encodeStub);
      const d = deps({
        encodeAvif,
        decodeFile: async () => frame(80, 60, 200),
        decode: async () => frame(80, 60, 128),
      });
      const out = await processExport(sdrJpeg(), PHOTO, { output: "avif" }, { longEdge: 80 }, d);
      expect(out.type).toBe("image/avif");
      expect(d.warn).not.toHaveBeenCalled();
      expect(d.renderGainMap).toHaveBeenCalledWith(PHOTO, 80);
      const [sdr, gain] = encodeAvif.mock.calls[0];
      expect([sdr.width, sdr.height, gain.width, gain.height]).toEqual([80, 60, 80, 60]);
    });

    it("asks for the original size when the export keeps it", async () => {
      const d = deps();
      await processExport(sdrJpeg(), PHOTO, { output: "avif" }, { longEdge: null }, d);
      expect(d.renderGainMap).toHaveBeenCalledWith(PHOTO, null);
    });

    it("scales a gain map that is a pixel off, or half the size, to the delivered image", async () => {
      for (const [w, h] of [
        [41, 30],
        [20, 15],
      ]) {
        const encodeAvif = vi.fn(encodeStub);
        const d = deps({ encodeAvif, decode: async () => frame(w, h, 128) });
        await processExport(sdrJpeg(), PHOTO, { output: "avif" }, CTX, d);
        expect(d.warn).not.toHaveBeenCalled();
        const [sdr, gain] = encodeAvif.mock.calls[0];
        expect([gain.width, gain.height]).toEqual([sdr.width, sdr.height]);
        expect(gain.data[0]).toBe(128);
      }
    });

    it("builds on a PNG or WebP export too, and leaves other formats alone, saying why", async () => {
      for (const type of ["image/png", "image/webp"]) {
        const out = await processExport(new Blob(["x"], { type }), PHOTO, { output: "avif" }, CTX, deps());
        expect(out.type).toBe("image/avif");
      }
      const tiff = new Blob(["tiff"], { type: "image/tiff" });
      const d = deps();
      expect(await processExport(tiff, PHOTO, { output: "avif" }, CTX, d)).toBe(tiff);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("JPEG, PNG or WebP"));
    });

    it("falls back to the SDR file, telling the user, when the gain map has another shape", async () => {
      const blob = sdrJpeg();
      const encodeAvif = vi.fn(encodeStub);
      const d = deps({ decode: async () => frame(40, 20, 128), encodeAvif });
      expect(await processExport(blob, PHOTO, { output: "avif" }, CTX, d)).toBe(blob);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("gain map"));
      expect(encodeAvif).not.toHaveBeenCalled();
    });

    it("falls back to the SDR file when the delivered file doesn't decode", async () => {
      const blob = sdrJpeg();
      const d = deps({ decodeFile: vi.fn(async () => null) });
      expect(await processExport(blob, PHOTO, { output: "avif" }, CTX, d)).toBe(blob);
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("didn't decode"));
    });

    it("falls back to the SDR file when the gain map is missing", async () => {
      const blob = sdrJpeg();
      const d = deps({ renderGainMap: vi.fn(async () => null) });
      expect(await processExport(blob, PHOTO, { output: "avif" }, CTX, d)).toBe(blob);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.warn.mock.calls[0][0]).toContain("gain map didn't render");
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("gain map didn't render"));
    });

    it("falls back to the SDR file, telling the user why, when the AVIF encoder fails", async () => {
      const blob = sdrJpeg();
      const d = deps({ encodeAvif: async () => { throw new Error("wasm missing"); } });
      expect(await processExport(blob, PHOTO, { output: "avif" }, CTX, d)).toBe(blob);
      expect(d.warn.mock.calls[0][0]).toContain("wasm missing");
      expect(d.notify).toHaveBeenCalledTimes(1);
      expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("wasm missing"));
    });

    describe("metadata", () => {
      // The core writes the export's metadata into the file it delivers only when
      // the user opted in, and strips GPS unless they opted into location too, so
      // the Exif block in that file is what the AVIF should carry.
      const TIFF = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
      const withExif = (): Blob => {
        const base = sdrBytes();
        const exif = segment(0xe1, concat([Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0), TIFF]));
        return new Blob([new Uint8Array(concat([base.subarray(0, 2), exif, base.subarray(2)]))], { type: "image/jpeg" });
      };

      it("carries the delivered file's Exif block into the AVIF", async () => {
        const d = deps({ encodeAvif: async () => avifForExif() });
        const out = await processExport(withExif(), PHOTO, { output: "avif" }, CTX, d);
        expect(out.type).toBe("image/avif");
        expect(readExif(new Uint8Array(await out.arrayBuffer()))).toEqual({ tiff: TIFF, describes: 1 });
        expect(d.notify).not.toHaveBeenCalled();
      });

      it("adds none when the delivered file has none", async () => {
        const d = deps({ encodeAvif: async () => avifForExif() });
        const out = await processExport(sdrJpeg(), PHOTO, { output: "avif" }, CTX, d);
        expect(readExif(new Uint8Array(await out.arrayBuffer()))).toBeNull();
        expect(d.notify).not.toHaveBeenCalled();
      });

      it("still delivers the HDR AVIF, and says the metadata is missing, when it can't be added", async () => {
        const d = deps({ encodeAvif: async () => avifLike() });
        const out = await processExport(withExif(), PHOTO, { output: "avif" }, CTX, d);
        expect(out.type).toBe("image/avif");
        expect(d.warn).toHaveBeenCalledTimes(1);
        expect(d.notify).toHaveBeenCalledTimes(1);
        expect(d.notify).toHaveBeenCalledWith(PHOTO, expect.stringContaining("without its metadata"));
      });
    });

    it.each([
      [70, 70],
      ["65", 65],
      [" 65 ", 65],
      [72.6, 73],
      [0, 1],
      [-5, 1],
      [500, 100],
      ["", 80],
      ["high", 80],
      [Number.NaN, 80],
      [Number.POSITIVE_INFINITY, 80],
      [null, 80],
      [undefined, 80],
      [true, 80],
    ])("encodes at quality %s as %i", async (setting, expected) => {
      const encodeAvif = vi.fn(encodeStub);
      await processExport(sdrJpeg(), PHOTO, { output: "avif", avifQuality: setting }, CTX, deps({ encodeAvif }));
      expect(encodeAvif.mock.calls[0][3]).toBe(expected);
    });
  });
});

describe("historyCursor", () => {
  // The core's rule (src/catalog/history-cursor.ts), copied: Develop, Export
  // and this extension must open the same snapshot of a damaged edit.
  it.each([
    [0, 0],
    [2, 2],
    [1.9, 1],
    [-0.5, 0],
    [-3, 0],
    [99, 2],
    [Number.POSITIVE_INFINITY, 2],
    [Number.NEGATIVE_INFINITY, 0],
    [Number.NaN, 2],
    ["1", 2],
    [null, 2],
    [undefined, 2],
  ])("resolves %s to snapshot %i of three", (cursor, expected) => {
    expect(historyCursor(cursor, 3)).toBe(expected);
  });
});

describe("liveExportDeps", () => {
  const stack = [
    { params: { tag: "first" }, paramBag: { [KEY.on]: 0 } },
    { params: { tag: "second" } },
    { params: { tag: "third" }, paramBag: { [KEY.on]: 1 } },
  ];

  function host(state: unknown, rendered: unknown[] = [{ blob: new Blob(["png"]), width: 1, height: 1 }]) {
    const getEditState = vi.fn(async () => state);
    const renderPhotos = vi.fn(async () => rendered);
    initRuntime({ catalog: { getEditState }, export: { renderPhotos } } as unknown as SafelightAPI);
    return { getEditState, renderPhotos };
  }

  it("reads the stage params and develop params of the snapshot at the edit's cursor", async () => {
    const { getEditState } = host({ photoId: "p1", stack, currentIndex: 2 });
    expect(await liveExportDeps().edit("p1")).toEqual({ bag: { [KEY.on]: 1 }, params: { tag: "third" } });
    expect(getEditState).toHaveBeenCalledWith("p1");
  });

  it("reads a snapshot without stage params as an empty bag", async () => {
    host({ photoId: "p1", stack, currentIndex: 1 });
    expect(await liveExportDeps().edit("p1")).toEqual({ bag: {}, params: { tag: "second" } });
  });

  it.each([
    ["a fraction", 0.9, "first"],
    ["a cursor past the end", 7, "third"],
    ["a negative cursor", -4, "first"],
    ["NaN", Number.NaN, "third"],
    ["a cursor that isn't a number", "0", "third"],
  ])("opens the snapshot a damaged cursor resolves to: %s", async (_what, currentIndex, tag) => {
    host({ photoId: "p1", stack, currentIndex });
    expect((await liveExportDeps().edit("p1"))?.params).toEqual({ tag });
  });

  it("has no edit for a photo without a stored edit or with an empty history", async () => {
    host(null);
    expect(await liveExportDeps().edit("p1")).toBeNull();
    host({ photoId: "p1", stack: [], currentIndex: 0 });
    expect(await liveExportDeps().edit("p1")).toBeNull();
  });

  // The gain map is a ratio image: sharpening it, or tagging it with another
  // colour space, would put edges and gamut into the gain. The SDR image comes
  // from the delivered file, which has the export's own settings.
  it("renders the gain map as a lossless, unsharpened PNG by patching the stage's output mode, over a copy of the patch", async () => {
    const { renderPhotos } = host(null);
    const blob = await liveExportDeps().renderGainMap(PHOTO, 3000);
    expect(blob).toBeInstanceOf(Blob);
    expect(renderPhotos).toHaveBeenCalledWith(
      [PHOTO],
      { format: "image/png", longEdge: 3000, colorSpace: "srgb", sharpenAmount: 0, includeMetadata: false },
      undefined,
      { paramBag: { [KEY.mode]: 1 } },
    );
    const options = renderPhotos.mock.calls[0] as unknown as [unknown, unknown, unknown, { paramBag: Record<string, unknown> }];
    expect(options[3].paramBag).not.toBe(GAIN_MAP_PATCH);
  });

  it("renders the gain map at the original size when the export keeps it", async () => {
    const { renderPhotos } = host(null);
    await liveExportDeps().renderGainMap(PHOTO, null);
    expect(renderPhotos).toHaveBeenCalledWith(
      [PHOTO],
      expect.objectContaining({ format: "image/png", longEdge: null }),
      undefined,
      { paramBag: { [KEY.mode]: 1 } },
    );
  });

  it("never lets a notice that can't be shown cost the export its file", () => {
    // No document here, as when the window is gone mid-export.
    host(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() => liveExportDeps().notify(PHOTO, "was exported without HDR: boom")).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  // The AVIF's base image: the export's own settings (size, sharpening) kept,
  // the lossy encode and the metadata dropped, sRGB so the pixels read back
  // are the values the HDR rendition is derived from.
  it("renders the AVIF's base image as a lossless sRGB PNG that keeps the export's size and sharpening", async () => {
    const { renderPhotos } = host(null);
    const blob = await liveExportDeps().renderBase(PHOTO, {
      format: "image/jpeg",
      quality: 0.4,
      longEdge: 3000,
      colorSpace: "display-p3",
      sharpenAmount: 60,
      sharpenRadius: 1.2,
      includeMetadata: true,
      includeLocation: true,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(renderPhotos).toHaveBeenCalledWith([PHOTO], {
      format: "image/png",
      quality: 0.4,
      longEdge: 3000,
      colorSpace: "srgb",
      sharpenAmount: 60,
      sharpenRadius: 1.2,
      pngBitDepth: 8,
      includeMetadata: false,
      includeLocation: false,
    });
  });

  it("has no base image when the render returns none", async () => {
    host(null, [{ blob: null, width: 0, height: 0 }]);
    expect(await liveExportDeps().renderBase(PHOTO, { longEdge: 100 })).toBeNull();
    host(null, []);
    expect(await liveExportDeps().renderBase(PHOTO, { longEdge: 100 })).toBeNull();
  });

  it("has no gain map when the render returns none", async () => {
    host(null, []);
    expect(await liveExportDeps().renderGainMap(PHOTO, 100)).toBeNull();
    host(null, [{ blob: null, width: 0, height: 0 }]);
    expect(await liveExportDeps().renderGainMap(PHOTO, 100)).toBeNull();
  });

  describe("HDR AVIF in the worker", () => {
    afterEach(() => {
      avifWorker.stop();
      vi.unstubAllGlobals();
    });

    /** A Worker that answers each job a turn later, as `respond` decides. */
    function stubWorker(respond: (worker: AvifWorkerLike, job: AvifJob) => void) {
      const jobs: { message: AvifJob; transfer: Transferable[] }[] = [];
      vi.stubGlobal("location", { origin: "app://safelight" });
      vi.stubGlobal(
        "Worker",
        class implements AvifWorkerLike {
          onmessage: ((event: MessageEvent<AvifReply>) => void) | null = null;
          onerror: ((event: ErrorEvent) => void) | null = null;
          onmessageerror: ((event: MessageEvent) => void) | null = null;
          postMessage(message: AvifJob, transfer: Transferable[]): void {
            jobs.push({ message, transfer });
            setTimeout(() => respond(this, message));
          }
          terminate(): void {}
        },
      );
      return jobs;
    }

    it("encodes in the worker, handing it both frames' buffers", async () => {
      host(null);
      const jobs = stubWorker((w, job) => w.onmessage?.({ data: { id: job.id, avif: avifLike() } } as MessageEvent<AvifReply>));
      const sdr = frame(40, 30, 128);
      const gain = frame(40, 30, 64);
      const d = deps({
        decodeFile: async () => sdr,
        decode: async () => gain,
        encodeAvif: liveExportDeps().encodeAvif,
      });
      const out = await processExport(sdrJpeg(), PHOTO, { output: "avif", avifQuality: 70 }, CTX, d);
      expect(out.type).toBe("image/avif");
      expect(d.warn).not.toHaveBeenCalled();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].message).toMatchObject({ sdr, gain, headroom: 2, quality: 70 });
      expect(jobs[0].transfer).toEqual([sdr.data.buffer, gain.data.buffer]);
    });

    it("falls back to the SDR file with one warning when the worker fails", async () => {
      host(null);
      stubWorker((w) => w.onerror?.({ message: "Uncaught Error: boom", preventDefault: () => undefined } as unknown as ErrorEvent));
      const blob = sdrJpeg();
      const d = deps({ encodeAvif: liveExportDeps().encodeAvif });
      expect(await processExport(blob, PHOTO, { output: "avif" }, CTX, d)).toBe(blob);
      expect(d.warn).toHaveBeenCalledTimes(1);
      expect(d.warn.mock.calls[0][0]).toMatch(/^\[hdr-editing\] HDR export of p1 failed, exported without HDR: the AVIF worker stopped: Uncaught Error: boom$/);
    });
  });
});
