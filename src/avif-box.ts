// Rewrites CICP in an AVIF's colour box. jSquash encodes RGB with BT.601 YUV
// and writes colr/nclx = primaries 2, transfer 2, matrix 6, full range, and
// has no option for HDR signalling. libavif and Chromium's AVIF decoder take
// CICP from nclx before the AV1 sequence header, so patching the two u16s
// marks the file BT.2020 PQ; the matrix (what the YUV was made with) and the
// range stay. The box keeps its size, so nothing else moves. The sequence
// header in the primary item says the same thing a second time, and a decoder
// that reads the bitstream rather than the box would see 2/2 there, so
// patchSequenceHeaderCicp marks that too (the parsing is in av1-seq.ts).

import { patchColourDescription, readColourDescription, type ColourDescription } from "./av1-seq";

interface Box {
  type: string;
  content: number;
  end: number;
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

function children(bytes: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type: fourcc(bytes, at + 4), content: at + header, end: at + size });
    at += size;
  }
  return out;
}

// colour_type "nclx" (4) + colour_primaries (2) + transfer (2) + matrix (2) + range (1).
const NCLX_PAYLOAD = 11;

/** Offset of colour_primaries in the nclx colour box under meta › iprp › ipco.
 *  A colr box too short to hold the whole nclx layout doesn't count: reading
 *  or patching it would touch the box after it. */
function nclxAt(bytes: Uint8Array): number | null {
  const meta = children(bytes, 0, bytes.length).find((b) => b.type === "meta");
  if (!meta) return null;
  const iprp = children(bytes, meta.content + 4, meta.end).find((b) => b.type === "iprp");
  const ipco = iprp && children(bytes, iprp.content, iprp.end).find((b) => b.type === "ipco");
  const colr =
    ipco &&
    children(bytes, ipco.content, ipco.end).find(
      (b) => b.type === "colr" && b.end - b.content >= NCLX_PAYLOAD && fourcc(bytes, b.content) === "nclx",
    );
  return colr ? colr.content + 4 : null;
}

export function readNclx(bytes: Uint8Array): { primaries: number; transfer: number; matrix: number; fullRange: boolean } | null {
  const at = nclxAt(bytes);
  if (at === null) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    primaries: view.getUint16(at),
    transfer: view.getUint16(at + 2),
    matrix: view.getUint16(at + 4),
    fullRange: (bytes[at + 6] & 0x80) !== 0,
  };
}

/** In place; false when the file has no nclx colour box. */
export function patchNclx(bytes: Uint8Array, primaries = 9, transfer = 16): boolean {
  const at = nclxAt(bytes);
  if (at === null) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(at, primaries);
  view.setUint16(at + 2, transfer);
  return true;
}

/** A read ran past the end of its box. */
class OutOfRange extends Error {}

class Cursor {
  private at: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.at = start;
  }

  /** Big-endian unsigned integer of `size` bytes (0 reads nothing and gives 0). */
  read(size: number): number {
    if (this.at + size > this.end) throw new OutOfRange();
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + this.bytes[this.at++];
    return value;
  }
}

const FIELD_SIZES = [0, 4, 8];

/** Byte range of the primary item's data, from pitm and iloc (ISO/IEC
 *  14496-12 §8.11.3-4). Only data in this file's own bytes (construction
 *  method 0, no external data reference) counts, and only the item's first
 *  extent: the sequence header is at the start of the data. */
function primaryItemData(bytes: Uint8Array): { start: number; end: number } | null {
  const meta = children(bytes, 0, bytes.length).find((b) => b.type === "meta");
  if (!meta) return null;
  const inside = children(bytes, meta.content + 4, meta.end);
  const pitm = inside.find((b) => b.type === "pitm");
  const iloc = inside.find((b) => b.type === "iloc");
  if (!pitm || !iloc) return null;
  try {
    const p = new Cursor(bytes, pitm.content, pitm.end);
    const pitmVersion = p.read(1);
    p.read(3);
    const primary = p.read(pitmVersion === 0 ? 2 : 4);

    const c = new Cursor(bytes, iloc.content, iloc.end);
    const version = c.read(1);
    c.read(3);
    if (version > 2) return null;
    const sizes = c.read(2);
    const offsetSize = sizes >> 12;
    const lengthSize = (sizes >> 8) & 15;
    const baseOffsetSize = (sizes >> 4) & 15;
    const indexSize = version === 0 ? 0 : sizes & 15;
    if (![offsetSize, lengthSize, baseOffsetSize].every((n) => FIELD_SIZES.includes(n)) || !(indexSize === 0 || FIELD_SIZES.includes(indexSize))) return null;
    const wide = version === 2;
    const count = c.read(wide ? 4 : 2);
    for (let i = 0; i < count; i++) {
      const id = c.read(wide ? 4 : 2);
      const method = version === 0 ? 0 : c.read(2) & 15;
      const dataReference = c.read(2);
      const base = c.read(baseOffsetSize);
      const extents = c.read(2);
      let first: { offset: number; length: number } | null = null;
      for (let e = 0; e < extents; e++) {
        c.read(indexSize);
        const extent = { offset: c.read(offsetSize), length: c.read(lengthSize) };
        first ??= extent;
      }
      if (id !== primary) continue;
      if (method !== 0 || dataReference !== 0 || !first || first.length === 0) return null;
      const start = base + first.offset;
      const end = start + first.length;
      return end <= bytes.length ? { start, end } : null;
    }
    return null;
  } catch (e) {
    if (e instanceof OutOfRange) return null;
    throw e;
  }
}

/** The colour description in the AV1 sequence header of the primary item, or
 *  null when the file doesn't lead to one. */
export function readSequenceHeaderCicp(bytes: Uint8Array): ColourDescription | null {
  const data = primaryItemData(bytes);
  return data && readColourDescription(bytes, data.start, data.end);
}

/** In place, like patchNclx: marks the primary item's sequence header with
 *  primaries and transfer, leaving its matrix and every other bit as written.
 *  False, bytes untouched, when the header can't be found or read; the colour
 *  box then still governs. */
export function patchSequenceHeaderCicp(bytes: Uint8Array, primaries = 9, transfer = 16): boolean {
  const data = primaryItemData(bytes);
  return data !== null && patchColourDescription(bytes, data.start, data.end, primaries, transfer);
}
