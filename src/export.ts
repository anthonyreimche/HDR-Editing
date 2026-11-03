// The Export panel's "HDR" section. For a photo with HDR on (current
// processing), the processor renders the gain map through
// api.export.renderPhotos with GAIN_MAP_PATCH (that nested render runs no
// processors), then either wraps the core's SDR JPEG and the gain map into an
// Ultra HDR JPEG, or has the AVIF worker rebuild the HDR rendition from the
// core's file and the gain map into a PQ Rec.2020 AVIF (avif-worker-client.ts).
// Anything that goes wrong for a photo falls back to the core's SDR file; the
// batch goes on. The fallback is logged and shown to the user (notice.ts), as
// the file that comes out looks like any other export.
//
// The gain map is rendered at the export's own long-edge setting, not the size
// of the file the core delivered: the setting caps the source before the crop,
// so the delivered size of a cropped photo is not a long edge that reproduces
// the same pixel grid. The two come out within a pixel of each other.
//
// The file the core delivered has been through the export's encoder, and a
// JPEG at a low quality carries its artifacts into an AVIF built from it. So
// when the processor is told the export's settings (Safelight 3.2.0), the AVIF's
// base image is a lossless render with those settings instead: the size and
// output sharpening are the export's, and the colour space is sRGB, which is
// what the HDR rendition is derived from (pq.ts). A core that doesn't pass the
// settings gets the delivered file, read back as sRGB.
//  - Metadata comes from the delivered file either way: its Exif block is what
//    the user chose to ship, GPS included or not, and goes into the AVIF
//    (avif-exif.ts). XMP and other metadata are not carried.
//  - Colour space doesn't carry: the AVIF is Rec.2020 PQ whatever the export
//    asked for.

import { patchNclx } from "./avif-box";
import { addExif } from "./avif-exif";
import { avifWorker } from "./avif-worker-client";
import { exifFromFile } from "./exif";
import { readbackBitmap, resizeFrame, type FrameSample } from "./frame";
import { encodeGreyJpeg } from "./jpeg-encode";
import { jpegSize } from "./jpeg";
import type { GainParams } from "./model";
import { fallbackBoard } from "./notice";
import { GAIN_MAP_PATCH, isCurrentProcessing, readParams } from "./params";
import { checkGainMapSize } from "./pq";
import { api } from "./runtime";
import type { CatalogPhotoLike, ExportProcessorContext, ExportProcessorField, ExportSettingsPatch } from "./safelight";
import { assembleUltraHdr } from "./ultrahdr";

export const GAIN_MAP_QUALITY = 90;

const DEFAULT_AVIF_QUALITY = 80;

export const PROCESSOR_FIELDS: ExportProcessorField[] = [
  {
    key: "output",
    label: "HDR output",
    hint: "For photos with HDR on. Ultra HDR needs the JPEG format. HDR AVIF replaces a JPEG, PNG or WebP file with one built from it. It is always Rec.2020 PQ, so the colour space setting doesn't apply, and it carries the Exif metadata only. A photo that can't get HDR is exported as it is, and listed in a notice.",
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
  /** A lossless PNG of the photo's gain map at the export's long-edge setting
   *  (null: original size). */
  renderGainMap(photo: CatalogPhotoLike, longEdge: number | null): Promise<Blob | null>;
  /** A lossless sRGB PNG of the photo with the export's settings (size,
   *  output sharpening), without metadata: the AVIF's SDR base image. */
  renderBase(photo: CatalogPhotoLike, settings: Readonly<ExportSettingsPatch>): Promise<Blob | null>;
  /** A lossless PNG, read back without any colour conversion. */
  decode(png: Blob): Promise<FrameSample | null>;
  /** The file the core delivered, read back as sRGB. */
  decodeFile(file: Blob): Promise<FrameSample | null>;
  /** The HDR rendition of an SDR frame and its same-size gain map, as a PQ
   *  AVIF. The frames may come back emptied (their buffers transferred). */
  encodeAvif(sdr: FrameSample, gain: FrameSample, headroom: number, quality: number): Promise<Uint8Array>;
  warn(message: string): void;
  /** Tells the user what happened to a photo, as a clause that follows its name. */
  notify(photo: CatalogPhotoLike, problem: string): void;
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

async function renderGainMap(photo: CatalogPhotoLike, longEdge: number | null, deps: ExportDeps): Promise<FrameSample> {
  const png = await deps.renderGainMap(photo, longEdge);
  const frame = png && (await deps.decode(png));
  if (!frame) throw new Error("the gain map didn't render");
  return frame;
}

/** The file as it was exported, for a reason the user should hear: logged,
 *  shown, and handed back. */
function exportedWithoutHdr(blob: Blob, photo: CatalogPhotoLike, reason: string, deps: ExportDeps): Blob {
  deps.warn(`[hdr-editing] HDR export of ${photo.id} failed, exported without HDR: ${reason}`);
  deps.notify(photo, `was exported without HDR: ${reason}`);
  return blob;
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
    return exportedWithoutHdr(blob, photo, "Ultra HDR needs the JPEG export format", deps);
  }
  const sdr = new Uint8Array(await blob.arrayBuffer());
  const size = jpegSize(sdr);
  if (!size) throw new Error("the exported JPEG has no size");
  const gain = await renderGainMap(photo, longEdge, deps);
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
  context: ExportProcessorContext,
  deps: ExportDeps,
): Promise<Blob> {
  if (blob.type !== "image/jpeg" && blob.type !== "image/png" && blob.type !== "image/webp") {
    return exportedWithoutHdr(blob, photo, "HDR AVIF needs the JPEG, PNG or WebP export format", deps);
  }
  const sdr = await sdrBase(blob, photo, context, deps);
  const gain = await renderGainMap(photo, context.longEdge, deps);
  if (!sameShape(gain, sdr)) {
    throw new Error(`the gain map came out ${gain.width}×${gain.height}, not the shape of the ${sdr.width}×${sdr.height} image`);
  }
  const fitted = resizeFrame(gain, sdr.width, sdr.height);
  checkGainMapSize(sdr, fitted);
  const avif = await deps.encodeAvif(sdr, fitted, p.headroom, quality);
  if (!patchNclx(avif)) throw new Error("the AVIF has no colour box to mark as PQ");
  return blobOf(await withMetadata(avif, blob, photo, deps), "image/avif");
}

async function sdrBase(delivered: Blob, photo: CatalogPhotoLike, context: ExportProcessorContext, deps: ExportDeps): Promise<FrameSample> {
  if (!context.settings) {
    const frame = await deps.decodeFile(delivered);
    if (!frame) throw new Error("the exported file didn't decode");
    return frame;
  }
  const png = await deps.renderBase(photo, context.settings);
  const frame = png && (await deps.decode(png));
  if (!frame) throw new Error("the base image didn't render");
  return frame;
}

/** The AVIF with the Exif block of the file the core delivered, if it had one.
 *  An AVIF that can't take it is still the HDR file; the user is told. */
async function withMetadata(avif: Uint8Array, delivered: Blob, photo: CatalogPhotoLike, deps: ExportDeps): Promise<Uint8Array> {
  const tiff = exifFromFile(new Uint8Array(await delivered.arrayBuffer()));
  if (!tiff) return avif;
  const withExif = addExif(avif, tiff);
  if (withExif) return withExif;
  deps.warn(`[hdr-editing] the Exif metadata of ${photo.id} couldn't be added to its HDR AVIF.`);
  deps.notify(photo, "was exported without its metadata: the HDR AVIF couldn't take it");
  return avif;
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
    return await hdrAvif(blob, photo, p, avifQuality(settings.avifQuality), context, deps);
  } catch (err) {
    return exportedWithoutHdr(blob, photo, err instanceof Error ? err.message : String(err), deps);
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
    // A gain map is a ratio image: it is rendered unsharpened, and in sRGB so
    // the export's colour space doesn't move its values.
    renderBase: async (photo, settings) => {
      const [out] = await a.export.renderPhotos([photo], {
        ...settings,
        format: "image/png",
        pngBitDepth: 8,
        colorSpace: "srgb",
        includeMetadata: false,
        includeLocation: false,
      });
      return out?.blob ?? null;
    },
    renderGainMap: async (photo, longEdge) => {
      const [out] = await a.export.renderPhotos(
        [photo],
        { format: "image/png", longEdge, colorSpace: "srgb", sharpenAmount: 0, includeMetadata: false },
        undefined,
        { paramBag: { ...GAIN_MAP_PATCH } },
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
    // Read as the colour-managed image the file is: a wide-gamut export comes
    // out as sRGB, which is what the HDR rendition is derived from.
    decodeFile: async (file) => {
      const bitmap = await createImageBitmap(file, { colorSpaceConversion: "default", premultiplyAlpha: "none" });
      try {
        return readbackBitmap(bitmap, Number.POSITIVE_INFINITY);
      } finally {
        bitmap.close();
      }
    },
    encodeAvif: (sdr, gain, headroom, quality) => avifWorker.encode(sdr, gain, headroom, quality),
    warn: (message) => console.warn(message),
    // The warning is already logged; a notice that can't be shown must not
    // cost the export its file.
    notify: (photo, problem) => {
      try {
        fallbackBoard.add(photo.filename ?? photo.id, problem);
      } catch (err) {
        console.warn(`[hdr-editing] couldn't show the export notice: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
