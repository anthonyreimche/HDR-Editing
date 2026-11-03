import { describe, expect, it } from "vitest";
import { exifFromFile } from "../src/exif";
import { encodeGreyJpeg } from "../src/jpeg-encode";
import { ascii, concat, segment } from "../src/jpeg";

// A little-endian TIFF block: header, an IFD at offset 8 with one entry
// (Orientation = 1), and a next-IFD offset of 0.
const TIFF = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);

const EXIF_ID = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0);
const grey = () => encodeGreyJpeg(new Uint8Array(8 * 8).fill(100), 8, 8, 90);

/** The grey JPEG with `segments` inserted right after SOI. */
function jpegWith(...segments: Uint8Array[]): Uint8Array {
  const base = grey();
  return concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
}

const u32be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const u32le = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return concat([u32be(data.length), ascii(type), data, new Uint8Array(4)]);
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0);
  return concat([ascii(type), u32le(data.length), data, pad]);
}

function webpOf(...chunks: Uint8Array[]): Uint8Array {
  const body = concat([ascii("WEBP"), ...chunks]);
  return concat([ascii("RIFF"), u32le(body.length), body]);
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("exifFromFile", () => {
  it("reads the TIFF block from a JPEG's Exif APP1 segment", () => {
    const file = jpegWith(segment(0xe1, concat([EXIF_ID, TIFF])));
    expect(exifFromFile(file)).toEqual(TIFF);
  });

  it("skips an XMP APP1 segment and other markers ahead of the Exif one", () => {
    const xmp = segment(0xe1, concat([ascii("http://ns.adobe.com/xap/1.0/\0"), ascii("<x/>")]));
    const jfif = segment(0xe0, ascii("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
    expect(exifFromFile(jpegWith(jfif, xmp, segment(0xe1, concat([EXIF_ID, TIFF]))))).toEqual(TIFF);
  });

  it("has none for a JPEG without an Exif segment", () => {
    expect(exifFromFile(grey())).toBeNull();
  });

  it("reads a PNG's eXIf chunk", () => {
    const file = concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", new Uint8Array(13)),
      pngChunk("eXIf", TIFF),
      pngChunk("IDAT", Uint8Array.of(1, 2, 3)),
      pngChunk("IEND", new Uint8Array(0)),
    ]);
    expect(exifFromFile(file)).toEqual(TIFF);
  });

  it("has none for a PNG without an eXIf chunk", () => {
    const file = concat([PNG_SIGNATURE, pngChunk("IHDR", new Uint8Array(13)), pngChunk("IEND", new Uint8Array(0))]);
    expect(exifFromFile(file)).toBeNull();
  });

  it("reads a WebP's EXIF chunk, with or without the Exif identifier in front", () => {
    const bare = webpOf(webpChunk("VP8X", new Uint8Array(10)), webpChunk("EXIF", TIFF), webpChunk("VP8 ", Uint8Array.of(9, 9, 9)));
    expect(exifFromFile(bare)).toEqual(TIFF);
    const withId = webpOf(webpChunk("VP8X", new Uint8Array(10)), webpChunk("EXIF", concat([EXIF_ID, TIFF])));
    expect(exifFromFile(withId)).toEqual(TIFF);
  });

  it("has none for a WebP without an EXIF chunk", () => {
    expect(exifFromFile(webpOf(webpChunk("VP8 ", Uint8Array.of(1, 2, 3))))).toBeNull();
  });

  it("has none for a block that isn't a TIFF, or a file it can't read", () => {
    const junk = jpegWith(segment(0xe1, concat([EXIF_ID, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)])));
    expect(exifFromFile(junk)).toBeNull();
    expect(exifFromFile(ascii("not an image"))).toBeNull();
    expect(exifFromFile(new Uint8Array(0))).toBeNull();
    expect(exifFromFile(jpegWith(segment(0xe1, concat([EXIF_ID, TIFF]))).subarray(0, 12))).toBeNull();
    const cutPng = concat([PNG_SIGNATURE, u32be(500), ascii("eXIf"), TIFF]);
    expect(exifFromFile(cutPng)).toBeNull();
  });
});
