// The Exif block of a JPEG, PNG or WebP file, as the bare TIFF structure an
// AVIF Exif item holds (avif-exif.ts). The core writes the export's metadata
// into the file it delivers, and only when the user opted in, so what is here
// is exactly what the user chose to ship.

import { parseJpeg, payloadOf, startsWith } from "./jpeg";

const EXIF_ID = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0);
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** A TIFF block is little- ("II*\0") or big-endian ("MM\0*") and holds at
 *  least its 8-byte header. */
function asTiff(block: Uint8Array): Uint8Array | null {
  if (block.length < 8) return null;
  const little = block[0] === 0x49 && block[1] === 0x49 && block[2] === 0x2a && block[3] === 0;
  const big = block[0] === 0x4d && block[1] === 0x4d && block[2] === 0 && block[3] === 0x2a;
  return little || big ? block : null;
}

function fromJpeg(bytes: Uint8Array): Uint8Array | null {
  for (const s of parseJpeg(bytes).segments) {
    if (s.marker !== 0xe1) continue;
    const payload = payloadOf(bytes, s);
    if (startsWith(payload, EXIF_ID)) return payload.subarray(EXIF_ID.length);
  }
  return null;
}

function fromPng(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = PNG_SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const data = at + 8;
    if (data + length + 4 > bytes.length) return null;
    if (fourcc(bytes, at + 4) === "eXIf") return bytes.subarray(data, data + length);
    at = data + length + 4;
  }
  return null;
}

function fromWebp(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true);
    const data = at + 8;
    if (data + length > bytes.length) return null;
    if (fourcc(bytes, at) === "EXIF") {
      const block = bytes.subarray(data, data + length);
      return startsWith(block, EXIF_ID) ? block.subarray(EXIF_ID.length) : block;
    }
    at = data + length + (length % 2);
  }
  return null;
}

function blockOf(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return fromJpeg(bytes);
  if (startsWith(bytes, PNG_SIGNATURE)) return fromPng(bytes);
  if (bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP") return fromWebp(bytes);
  return null;
}

/** The TIFF block of the file's Exif metadata, or null when it has none or is
 *  not a file this can read. */
export function exifFromFile(bytes: Uint8Array): Uint8Array | null {
  try {
    const block = blockOf(bytes);
    return block && asTiff(block);
  } catch {
    return null;
  }
}
