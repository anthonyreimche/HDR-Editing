// Adds an Exif item to an AVIF. jSquash's encoder takes pixels and nothing
// else, so the metadata the export carried is put in afterwards, the way
// libavif stores it (ISO/IEC 23008-12 §A.2.1): an item of type "Exif" whose
// data is a 4-byte offset to the TIFF header followed by the Exif block, listed
// in iinf, located by iloc, and tied to the primary image by a "cdsc" entry in
// iref. The data goes in a second mdat at the end of the file.
//
// Growing meta moves mdat, and iloc offsets are absolute, so every offset into
// the old data is shifted by the growth. The result is read back before it is
// returned: every item the file had must still be where its iloc says, and the
// Exif item must read back whole. A file this can't read, or whose rewrite
// doesn't check out, gives null and the caller keeps the file as it was.

interface Box {
  type: string;
  start: number;
  content: number;
  end: number;
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The boxes that exactly tile [from, to), or null: a box that runs out of
 *  range, one with the 64-bit or to-the-end size forms, or bytes left over. */
function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (at + 8 > to) return null;
    const size = view.getUint32(at);
    if (size < 8 || at + size > to) return null;
    out.push({ type: fourcc(bytes, at + 4), start: at, content: at + 8, end: at + size });
    at += size;
  }
  return out;
}

/** Big-endian unsigned integer of `size` bytes at `at`. */
function readUint(bytes: Uint8Array, at: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + bytes[at + i];
  return value;
}

function uint(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
  return out;
}

const fits = (value: number, size: number) => value < 2 ** (8 * size);

function bytesOf(type: string, ...parts: (Uint8Array | number[])[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  out.set(uint(size, 4));
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

interface Extent {
  index: number;
  offset: number;
  length: number;
}

interface IlocEntry {
  id: number;
  method: number;
  dataReference: number;
  base: number;
  extents: Extent[];
}

interface Iloc {
  version: number;
  offsetSize: number;
  lengthSize: number;
  baseOffsetSize: number;
  indexSize: number;
  entries: IlocEntry[];
}

const FIELD_SIZES = [0, 4, 8];

function parseIloc(bytes: Uint8Array, box: Box): Iloc | null {
  let at = box.content;
  const need = (n: number) => at + n <= box.end;
  if (!need(8)) return null;
  const version = bytes[at];
  if (version > 2) return null;
  at += 4;
  const offsetSize = bytes[at] >> 4;
  const lengthSize = bytes[at] & 15;
  const baseOffsetSize = bytes[at + 1] >> 4;
  const indexSize = version === 0 ? 0 : bytes[at + 1] & 15;
  at += 2;
  if (![offsetSize, lengthSize, baseOffsetSize, indexSize].every((n) => FIELD_SIZES.includes(n))) return null;
  const wide = version === 2;
  const count = readUint(bytes, at, wide ? 4 : 2);
  at += wide ? 4 : 2;
  const entries: IlocEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (!need(wide ? 4 : 2)) return null;
    const id = readUint(bytes, at, wide ? 4 : 2);
    at += wide ? 4 : 2;
    let method = 0;
    if (version > 0) {
      if (!need(2)) return null;
      method = readUint(bytes, at, 2) & 15;
      at += 2;
    }
    if (!need(4 + baseOffsetSize)) return null;
    const dataReference = readUint(bytes, at, 2);
    const base = readUint(bytes, at + 2, baseOffsetSize);
    const extentCount = readUint(bytes, at + 2 + baseOffsetSize, 2);
    at += 4 + baseOffsetSize;
    const extents: Extent[] = [];
    for (let e = 0; e < extentCount; e++) {
      if (!need(indexSize + offsetSize + lengthSize)) return null;
      extents.push({
        index: readUint(bytes, at, indexSize),
        offset: readUint(bytes, at + indexSize, offsetSize),
        length: readUint(bytes, at + indexSize + offsetSize, lengthSize),
      });
      at += indexSize + offsetSize + lengthSize;
    }
    entries.push({ id, method, dataReference, base, extents });
  }
  return at === box.end ? { version, offsetSize, lengthSize, baseOffsetSize, indexSize, entries } : null;
}

function writeIloc(iloc: Iloc): Uint8Array {
  const wide = iloc.version === 2;
  const rows: number[] = [];
  for (const entry of iloc.entries) {
    rows.push(...uint(entry.id, wide ? 4 : 2));
    if (iloc.version > 0) rows.push(...uint(entry.method, 2));
    rows.push(...uint(entry.dataReference, 2), ...uint(entry.base, iloc.baseOffsetSize), ...uint(entry.extents.length, 2));
    for (const e of entry.extents) {
      rows.push(...uint(e.index, iloc.indexSize), ...uint(e.offset, iloc.offsetSize), ...uint(e.length, iloc.lengthSize));
    }
  }
  return bytesOf(
    "iloc",
    [iloc.version, 0, 0, 0, (iloc.offsetSize << 4) | iloc.lengthSize, (iloc.baseOffsetSize << 4) | iloc.indexSize],
    uint(iloc.entries.length, wide ? 4 : 2),
    rows,
  );
}

interface Meta {
  box: Box;
  children: Box[];
}

function metaOf(bytes: Uint8Array): Meta | null {
  const top = boxesIn(bytes, 0, bytes.length);
  const box = top?.find((b) => b.type === "meta");
  if (!box || box.end - box.content < 4 || bytes[box.content] !== 0) return null;
  const children = boxesIn(bytes, box.content + 4, box.end);
  return children && { box, children };
}

/** The primary item's id, from pitm. */
function primaryId(bytes: Uint8Array, pitm: Box): number | null {
  const wide = bytes[pitm.content] === 1;
  return pitm.end - pitm.content >= (wide ? 8 : 6) ? readUint(bytes, pitm.content + 4, wide ? 4 : 2) : null;
}

interface Infe {
  id: number;
  type: string | null;
}

/** The items iinf lists, with the type of each where its infe version says. */
function parseIinf(bytes: Uint8Array, box: Box): { version: number; countAt: number; countSize: number; items: Infe[] } | null {
  const version = bytes[box.content];
  if (version > 1) return null;
  const countSize = version === 0 ? 2 : 4;
  const countAt = box.content + 4;
  const infes = boxesIn(bytes, countAt + countSize, box.end);
  if (!infes || readUint(bytes, countAt, countSize) !== infes.length) return null;
  const items: Infe[] = [];
  for (const infe of infes) {
    if (infe.type !== "infe") return null;
    const v = bytes[infe.content];
    if (v < 2) {
      items.push({ id: readUint(bytes, infe.content + 4, 2), type: null });
    } else {
      const idSize = v === 3 ? 4 : 2;
      if (infe.end - infe.content < 4 + idSize + 2 + 4) return null;
      items.push({ id: readUint(bytes, infe.content + 4, idSize), type: fourcc(bytes, infe.content + 4 + idSize + 2) });
    }
  }
  return { version, countAt, countSize, items };
}

/** The items a "cdsc" entry of iref ties to another: from id → to ids. */
function describes(bytes: Uint8Array, iref: Box): Map<number, number[]> | null {
  const version = bytes[iref.content];
  if (version > 1) return null;
  const idSize = version === 0 ? 2 : 4;
  const refs = boxesIn(bytes, iref.content + 4, iref.end);
  if (!refs) return null;
  const out = new Map<number, number[]>();
  for (const ref of refs) {
    if (ref.type !== "cdsc") continue;
    if (ref.end - ref.content < idSize + 2) return null;
    const count = readUint(bytes, ref.content + idSize, 2);
    if (ref.end - ref.content < idSize + 2 + count * idSize) return null;
    const to: number[] = [];
    for (let i = 0; i < count; i++) to.push(readUint(bytes, ref.content + idSize + 2 + i * idSize, idSize));
    out.set(readUint(bytes, ref.content, idSize), to);
  }
  return out;
}

/** Each item's data from iloc, for the items kept in this file's own bytes
 *  (construction method 0, no external data reference). An item whose extents
 *  run past the end of the file is left out. */
export function itemData(bytes: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const meta = metaOf(bytes);
  const box = meta?.children.find((b) => b.type === "iloc");
  const iloc = box && parseIloc(bytes, box);
  if (!iloc) return out;
  for (const entry of iloc.entries) {
    if (entry.method !== 0 || entry.dataReference !== 0) continue;
    const parts = entry.extents.map((e) => ({ start: entry.base + e.offset, length: e.length }));
    if (parts.some((p) => p.start + p.length > bytes.length)) continue;
    if (parts.length === 1) {
      out.set(entry.id, bytes.subarray(parts[0].start, parts[0].start + parts[0].length));
      continue;
    }
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      joined.set(bytes.subarray(p.start, p.start + p.length), at);
      at += p.length;
    }
    out.set(entry.id, joined);
  }
  return out;
}

/** The Exif block of an AVIF and the item it describes, or null when the file
 *  has none or its tables don't lead to one. */
export function readExif(bytes: Uint8Array): { tiff: Uint8Array; describes: number } | null {
  const meta = metaOf(bytes);
  const iinfBox = meta?.children.find((b) => b.type === "iinf");
  const irefBox = meta?.children.find((b) => b.type === "iref");
  const iinf = iinfBox && parseIinf(bytes, iinfBox);
  const exif = iinf?.items.find((i) => i.type === "Exif");
  const refs = irefBox && describes(bytes, irefBox);
  const block = exif && itemData(bytes).get(exif.id);
  const target = exif && refs?.get(exif.id)?.[0];
  if (!block || block.length < 4 || target === undefined) return null;
  const skip = readUint(block, 0, 4);
  return 4 + skip <= block.length ? { tiff: block.subarray(4 + skip), describes: target } : null;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** `avif` with `tiff` (an Exif block, from its TIFF header) added as an Exif
 *  item of its primary image; null when the file's item tables aren't ones this
 *  can extend, or the result doesn't read back as it should. The input is
 *  not changed. */
export function addExif(avif: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  if (tiff.length === 0) return null;
  const meta = metaOf(avif);
  if (!meta) return null;
  const find = (type: string) => meta.children.find((b) => b.type === type);
  const [pitm, ilocBox, iinfBox, irefBox] = [find("pitm"), find("iloc"), find("iinf"), find("iref")];
  if (!pitm || !ilocBox || !iinfBox) return null;
  const primary = primaryId(avif, pitm);
  const iloc = parseIloc(avif, ilocBox);
  const iinf = parseIinf(avif, iinfBox);
  if (irefBox && avif[irefBox.content] > 1) return null;
  if (primary === null || !iloc || !iinf) return null;

  // infe version 2 numbers items in 16 bits.
  const exifId = Math.max(...iinf.items.map((i) => i.id), ...iloc.entries.map((e) => e.id)) + 1;
  if (exifId >= 2 ** 16 || iloc.offsetSize === 0 || iloc.lengthSize === 0) return null;

  // iinf: one more entry.
  const infe = bytesOf("infe", [2, 0, 0, 0], uint(exifId, 2), [0, 0], Array.from(new TextEncoder().encode("Exif\0")));
  const iinfBytes = bytesOf(
    "iinf",
    [iinf.version, 0, 0, 0],
    uint(iinf.items.length + 1, iinf.countSize),
    avif.subarray(iinf.countAt + iinf.countSize, iinfBox.end),
    infe,
  );

  // iref: a "cdsc" entry from the Exif item to the primary image.
  const refWide = irefBox ? avif[irefBox.content] === 1 : primary >= 2 ** 16;
  const cdsc = bytesOf("cdsc", uint(exifId, refWide ? 4 : 2), uint(1, 2), uint(primary, refWide ? 4 : 2));
  const irefBytes = irefBox
    ? bytesOf("iref", Array.from(avif.subarray(irefBox.content, irefBox.end)), cdsc)
    : bytesOf("iref", [refWide ? 1 : 0, 0, 0, 0], cdsc);
  // Sizes of the rewritten boxes don't depend on the offsets they hold, so
  // how far mdat moves is known before any offset is written.
  const idSize = iloc.version === 2 ? 4 : 2;
  const methodSize = iloc.version > 0 ? 2 : 0;
  const extentSize = iloc.indexSize + iloc.offsetSize + iloc.lengthSize;
  const entrySize = idSize + methodSize + 2 + iloc.baseOffsetSize + 2 + extentSize;
  const sizeOf = (b: Box) => b.end - b.start;
  const delta = iinfBytes.length - sizeOf(iinfBox) + irefBytes.length - (irefBox ? sizeOf(irefBox) : 0) + entrySize;

  // The block is preceded by the offset from its start to the TIFF header: 0.
  const data = new Uint8Array(4 + tiff.length);
  data.set(tiff, 4);
  const exifAt = avif.length + delta + 8;

  const shifted: Iloc = {
    ...iloc,
    entries: iloc.entries.map((entry) => {
      if (entry.method !== 0 || entry.dataReference !== 0) return entry;
      if (!entry.extents.some((e) => entry.base + e.offset >= meta.box.end)) return entry;
      if (iloc.baseOffsetSize > 0) return { ...entry, base: entry.base + delta };
      return { ...entry, extents: entry.extents.map((e) => ({ ...e, offset: e.offset + delta })) };
    }),
  };
  shifted.entries.push({
    id: exifId,
    method: 0,
    dataReference: 0,
    base: 0,
    extents: [{ index: 0, offset: exifAt, length: data.length }],
  });
  const fieldsFit = shifted.entries.every(
    (e) => fits(e.base, iloc.baseOffsetSize) && e.extents.every((x) => fits(x.offset, iloc.offsetSize) && fits(x.length, iloc.lengthSize)),
  );
  if (!fieldsFit) return null;

  const pieces: Uint8Array[] = [];
  for (const child of meta.children) {
    if (child === ilocBox) pieces.push(writeIloc(shifted));
    else if (child === iinfBox) pieces.push(iinfBytes);
    else if (child === irefBox) pieces.push(irefBytes);
    else pieces.push(avif.subarray(child.start, child.end));
    if (child === iinfBox && !irefBox) pieces.push(irefBytes);
  }
  const metaBytes = bytesOf("meta", Array.from(avif.subarray(meta.box.content, meta.box.content + 4)), ...pieces);
  if (metaBytes.length - sizeOf(meta.box) !== delta) return null;

  const mdat = bytesOf("mdat", data);
  const out = new Uint8Array(avif.length + delta + mdat.length);
  out.set(avif.subarray(0, meta.box.start));
  out.set(metaBytes, meta.box.start);
  out.set(avif.subarray(meta.box.end), meta.box.start + metaBytes.length);
  out.set(mdat, avif.length + delta);
  return holds(avif, out, tiff, primary) ? out : null;
}

function holds(before: Uint8Array, after: Uint8Array, tiff: Uint8Array, primary: number): boolean {
  if (!boxesIn(after, 0, after.length)) return false;
  const kept = itemData(after);
  for (const [id, data] of itemData(before)) {
    const now = kept.get(id);
    if (!now || !same(now, data)) return false;
  }
  const exif = readExif(after);
  return exif !== null && exif.describes === primary && same(exif.tiff, tiff);
}
