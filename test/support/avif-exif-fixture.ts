// An ISOBMFF AVIF skeleton with the item tables an Exif item has to be added
// to: pitm, iloc, iinf, optionally iref, and an mdat the iloc really points
// into. Written from ISO/IEC 14496-12 (§8.11) with the field widths and box
// versions as options.

import { box, concat, ftyp, ispe, nclxColr } from "./avif-fixture";

const enc = (s: string) => new TextEncoder().encode(s);

function uint(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
  return out;
}

export interface ExifFixtureOptions {
  ilocVersion?: 0 | 1 | 2;
  offsetSize?: 4 | 8;
  lengthSize?: 4 | 8;
  /** 0 puts each item's whole position in its extent offset; 4 splits it. */
  baseOffsetSize?: 0 | 4;
  indexSize?: 0 | 4;
  iinfVersion?: 0 | 1;
  /** An iref with an auxl reference from item 2 to item 1, as an alpha plane has. */
  iref?: boolean;
  irefVersion?: 0 | 1;
  /** Items in the file; the first is primary. */
  items?: { id: number; data: Uint8Array }[];
  /** A box after mdat. */
  trailing?: Uint8Array;
}

export const DEFAULT_ITEMS = [
  { id: 1, data: Uint8Array.from({ length: 40 }, (_, i) => i + 1) },
  { id: 2, data: Uint8Array.from({ length: 24 }, (_, i) => 200 - i) },
];

export function avifForExif(o: ExifFixtureOptions = {}): Uint8Array {
  const items = o.items ?? DEFAULT_ITEMS;
  const ilocVersion = o.ilocVersion ?? 0;
  const offsetSize = o.offsetSize ?? 4;
  const lengthSize = o.lengthSize ?? 4;
  const baseOffsetSize = o.baseOffsetSize ?? 0;
  const indexSize = ilocVersion > 0 ? (o.indexSize ?? 0) : 0;
  const idSize = ilocVersion === 2 ? 4 : 2;

  const build = (dataStart: number): Uint8Array => {
    const rows: number[] = [];
    let at = 0;
    for (const item of items) {
      rows.push(...uint(item.id, idSize));
      if (ilocVersion > 0) rows.push(0, 0);
      rows.push(0, 0);
      const position = dataStart + at;
      rows.push(...uint(baseOffsetSize > 0 ? dataStart : 0, baseOffsetSize));
      rows.push(0, 1);
      rows.push(...uint(0, indexSize));
      rows.push(...uint(baseOffsetSize > 0 ? at : position, offsetSize));
      rows.push(...uint(item.data.length, lengthSize));
      at += item.data.length;
    }
    const iloc = box(
      "iloc",
      Uint8Array.of(ilocVersion, 0, 0, 0),
      Uint8Array.of((offsetSize << 4) | lengthSize, (baseOffsetSize << 4) | indexSize),
      Uint8Array.of(...uint(items.length, idSize)),
      Uint8Array.of(...rows),
    );
    const pitm = box("pitm", Uint8Array.of(0, 0, 0, 0, ...uint(items[0].id, 2)));
    const iinfVersion = o.iinfVersion ?? 0;
    const infes = items.map((i) => box("infe", Uint8Array.of(2, 0, 0, 0, ...uint(i.id, 2), 0, 0), enc("av01"), enc("Item\0")));
    const iinf = box("iinf", Uint8Array.of(iinfVersion, 0, 0, 0, ...uint(items.length, iinfVersion === 0 ? 2 : 4)), ...infes);
    const irefVersion = o.irefVersion ?? 0;
    const iref = o.iref
      ? box("iref", Uint8Array.of(irefVersion, 0, 0, 0), box("auxl", Uint8Array.of(...uint(2, irefVersion === 0 ? 2 : 4), 0, 1, ...uint(1, irefVersion === 0 ? 2 : 4))))
      : new Uint8Array(0);
    const iprp = box("iprp", box("ipco", ispe(), nclxColr()));
    return box("meta", new Uint8Array(4), box("hdlr", new Uint8Array(25)), pitm, iloc, iinf, iref, iprp);
  };

  const head = ftyp();
  const dataStart = head.length + build(0).length + 8;
  return concat(head, build(dataStart), box("mdat", ...items.map((i) => i.data)), o.trailing ?? new Uint8Array(0));
}
