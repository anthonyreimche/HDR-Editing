// The Export panel's "HDR" section. For a photo with HDR on (current
// processing), the processor renders the gain map through
// api.export.renderPhotos with GAIN_MAP_PATCH (that nested render runs no
// processors), then either wraps the core's SDR JPEG and the gain map into an
// Ultra HDR JPEG, or has the AVIF worker rebuild the HDR rendition into a PQ
// Rec.2020 AVIF (avif-worker-client.ts).
// Anything that goes wrong for a photo falls back to the core's SDR file and
// is logged; the batch goes on.
//
// The nested renders ask for the export's own long-edge setting, not the size
// of the file the core delivered: the setting caps the source before the crop,
// so the delivered size of a cropped photo is not a long edge that reproduces
// the same pixel grid.

import { patchNclx } from "./avif-box";
import { avifWorker } from "./avif-worker-client";
import { readbackBitmap, type FrameSample } from "./frame";
import { encodeGreyJpeg } from "./jpeg-encode";
import { jpegSize } from "./jpeg";
import type { GainParams } from "./model";
import { GAIN_MAP_PATCH, isCurrentProcessing, readParams } from "./params";
import { checkGainMapSize } from "./pq";
import { api } from "./runtime";
import type { CatalogPhotoLike, ExportProcessorContext, ExportProcessorField } from "./safelight";
import { assembleUltraHdr } from "./ultrahdr";

export const GAIN_MAP_QUALITY = 90;

const DEFAULT_AVIF_QUALITY = 80;

export const PROCESSOR_FIELDS: ExportProcessorField[] = [
  {
    key: "output",
    label: "HDR output",
    hint: "For photos with HDR on. Ultra HDR needs the JPEG format. HDR AVIF replaces a JPEG, PNG or WebP file with one built from an sRGB render, without metadata or output sharpening.",
    type: "select",
    default: "off",
    options: [
      { value: "off", label: "Off" },
      { value: "ultrahdr", label: "Ultra HDR JPEG" },
      { value: "avif", label: "HDR AVIF" },
    ],
  },
  { key: "avifQuality", label: "HDR AVIF quality", hint: "HDR AVIF only.", type: "number", default: DEFAULT_AVIF_QUALITY, min: 1, max: 100, step: 1 },
];

export interface ExportDeps {
  /** The photo's saved stage params and develop params, or null. */
  edit(photoId: string): Promise<{ bag: Record<string, unknown>; params: unknown } | null>;
  /** A lossless sRGB PNG of the photo at the export's long-edge setting (null:
   *  original size), plain or as its gain map. */
  render(photo: CatalogPhotoLike, longEdge: number | null, gainMap: boolean): Promise<Blob | null>;
  decode(png: Blob): Promise<FrameSample | null>;
  /** The HDR rendition of an SDR frame and its same-size gain map, as a PQ
   *  AVIF. The frames may come back emptied (their buffers transferred). */
  encodeAvif(sdr: FrameSample, gain: FrameSample, headroom: number, quality: number): Promise<Uint8Array>;
  warn(message: string): void;
}

/** TypeScript types a typed array by its buffer, and a Blob takes only
 *  ArrayBuffer-backed views; the encoders declare the wider type. The copy is
 *  one memcpy of a file already in memory. */
const blobOf = (bytes: Uint8Array, type: string): Blob => new Blob([new Uint8Array(bytes)], { type });

export function greyChannel(f: FrameSample): Uint8Array {
  const out = new Uint8Array(f.width * f.height);
  for (let i = 0; i < out.length; i++) out[i] = f.data[i * 4];
  return out;
}

/** The snapshot index a stored cursor resolves to, for a stack of `length >= 1`
 *  snapshots. This is the core's rule (src/catalog/history-cursor.ts), copied
 *  because an extension can't import core: Develop, Export and this processor
 *  must open the same snapshot of a damaged edit. A fraction truncates, an
 *  out-of-range number lands on the nearest end, and a value with no nearest
 *  end (NaN, or anything that is not a number) lands on the newest snapshot. */
export function historyCursor(currentIndex: unknown, length: number): number {
  const index = typeof currentIndex === "number" ? Math.trunc(currentIndex) : NaN;
  return Number.isNaN(index) ? length - 1 : Math.min(Math.max(index, 0), length - 1);
}

/** The quality field, which a preset or a hand-edited settings file can leave
 *  as a string or out of range: a number or numeric string, rounded and kept to
 *  1..100, and the default for anything else. */
function avifQuality(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_AVIF_QUALITY;
  return Math.min(100, Math.max(1, Math.round(n)));
}

async function renderAt(
  photo: CatalogPhotoLike,
  longEdge: number | null,
  gainMap: boolean,
  deps: ExportDeps,
): Promise<FrameSample> {
  const png = await deps.render(photo, longEdge, gainMap);
  const frame = png && (await deps.decode(png));
  if (!frame) throw new Error(`the ${gainMap ? "gain map" : "SDR image"} didn't render`);
  return frame;
}

/** A gain map may be stored at another resolution than the image, and readers
 *  scale it up; another shape they can't. Compared by cross-multiplication, a
 *  pixel of rounding on each side of the map moves the difference by up to the
 *  sum of the image's two dimensions. That also covers the image itself being
 *  a pixel off, when the export and the nested render came from different
 *  decodes of the source. */
export function sameShape(map: { width: number; height: number }, image: { width: number; height: number }): boolean {
  return Math.abs(map.width * image.height - map.height * image.width) <= image.width + image.height;
}

async function ultraHdr(
  blob: Blob,
  photo: CatalogPhotoLike,
  p: GainParams,
  longEdge: number | null,
  deps: ExportDeps,
): Promise<Blob> {
  if (blob.type !== "image/jpeg") {
    deps.warn(`[hdr-editing] Ultra HDR needs the JPEG export format; ${photo.id} was exported without HDR.`);
    return blob;
  }
  const sdr = new Uint8Array(await blob.arrayBuffer());
  const size = jpegSize(sdr);
  if (!size) throw new Error("the exported JPEG has no size");
  const gain = await renderAt(photo, longEdge, true, deps);
  if (!sameShape(gain, size)) {
    throw new Error(`the gain map came out ${gain.width}×${gain.height}, not the shape of the ${size.width}×${size.height} image`);
  }
  const map = encodeGreyJpeg(greyChannel(gain), gain.width, gain.height, GAIN_MAP_QUALITY);
  return blobOf(assembleUltraHdr(sdr, map, p.headroom), "image/jpeg");
}

async function hdrAvif(
  blob: Blob,
  photo: CatalogPhotoLike,
  p: GainParams,
  quality: number,
  longEdge: number | null,
  deps: ExportDeps,
): Promise<Blob> {
  if (blob.type !== "image/jpeg" && blob.type !== "image/png" && blob.type !== "image/webp") {
    deps.warn(`[hdr-editing] HDR AVIF needs the JPEG, PNG or WebP export format; ${photo.id} was exported without HDR.`);
    return blob;
  }
  // The AVIF replaces the core's file, so its pixels are the renders' own:
  // nothing is compared against the file's size, only the two renders against
  // each other, before they go to the encoder.
  const sdr = await renderAt(photo, longEdge, false, deps);
  const gain = await renderAt(photo, longEdge, true, deps);
  checkGainMapSize(sdr, gain);
  const avif = await deps.encodeAvif(sdr, gain, p.headroom, quality);
  if (!patchNclx(avif)) throw new Error("the AVIF has no colour box to mark as PQ");
  return blobOf(avif, "image/avif");
}

export async function processExport(
  blob: Blob,
  photo: CatalogPhotoLike,
  settings: Record<string, unknown>,
  context: ExportProcessorContext,
  deps: ExportDeps,
): Promise<Blob> {
  const output = settings.output;
  if (output !== "ultrahdr" && output !== "avif") return blob;
  try {
    const edit = await deps.edit(photo.id);
    if (!edit || !isCurrentProcessing(edit.params)) return blob;
    const p = readParams(edit.bag);
    if (!p.on) return blob;
    if (output === "ultrahdr") return await ultraHdr(blob, photo, p, context.longEdge, deps);
    return await hdrAvif(blob, photo, p, avifQuality(settings.avifQuality), context.longEdge, deps);
  } catch (err) {
    deps.warn(
      `[hdr-editing] HDR export of ${photo.id} failed, exported without HDR: ${err instanceof Error ? err.message : String(err)}`,
    );
    return blob;
  }
}

export function liveExportDeps(): ExportDeps {
  const a = api();
  return {
    edit: async (photoId) => {
      const state = await a.catalog.getEditState(photoId);
      if (!state || state.stack.length === 0) return null;
      const snapshot = state.stack[historyCursor(state.currentIndex, state.stack.length)];
      return { bag: snapshot.paramBag ?? {}, params: snapshot.params };
    },
    render: async (photo, longEdge, gainMap) => {
      const [out] = await a.export.renderPhotos(
        [photo],
        { format: "image/png", longEdge, colorSpace: "srgb", sharpenAmount: 0, includeMetadata: false },
        undefined,
        gainMap ? { paramBag: { ...GAIN_MAP_PATCH } } : undefined,
      );
      return out?.blob ?? null;
    },
    decode: async (png) => {
      const bitmap = await createImageBitmap(png, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      try {
        return readbackBitmap(bitmap, Number.POSITIVE_INFINITY);
      } finally {
        bitmap.close();
      }
    },
    encodeAvif: (sdr, gain, headroom, quality) => avifWorker.encode(sdr, gain, headroom, quality),
    warn: (message) => console.warn(message),
  };
}
