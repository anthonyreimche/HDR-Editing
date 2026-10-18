// An ISOBMFF file with a pitm and an iloc that really point into mdat, so the
// primary item's data can be told apart from other items' data. Written from
// ISO/IEC 14496-12 (iloc, pitm) with the field widths and version as options.

import { box, concat, ftyp, ispe, nclxColr } from "./avif-fixture";

export interface ItemSpec {
  id: number;
  data: Uint8Array;
}

export interface LayoutOptions {
  version?: 0 | 1 | 2;
  offsetSize?: 0 | 4 | 8;
  lengthSize?: 0 | 4 | 8;
  baseOffsetSize?: 0 | 4 | 8;
  /** pitm item_ID; null leaves the pitm box out. */
  primary?: number | null;
  constructionMethod?: number;
  /** Added to every extent_length, so the extent runs past the file. */
  lengthSlack?: number;
  withIloc?: boolean;
  /** data_reference_index of every item; non-zero means the data is in another file. */
  dataReference?: number;
  /** Width of the extent_index field, present in iloc versions 1 and 2. */
  indexSize?: 0 | 4 | 8;
  /** pitm version; 1 widens item_ID to 32 bits. */
  pitmVersion?: 0 | 1;
}

function uint(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
  return out;
}

export function avifWithItems(items: ItemSpec[], o: LayoutOptions = {}): Uint8Array {
  const version = o.version ?? 0;
  const offsetSize = o.offsetSize ?? 4;
  const lengthSize = o.lengthSize ?? 4;
  const baseOffsetSize = o.baseOffsetSize ?? 0;
  const indexSize = version > 0 ? (o.indexSize ?? 0) : 0;
  const pitmVersion = o.pitmVersion ?? 0;
  const primary = o.primary === undefined ? items[0].id : o.primary;
  const wide = version === 2;

  const build = (mdatStart: number): Uint8Array => {
    const rows: number[] = [];
    let offset = 0;
    for (const item of items) {
      rows.push(...uint(item.id, wide ? 4 : 2));
      if (version > 0) rows.push(...uint(o.constructionMethod ?? 0, 2));
      rows.push(...uint(o.dataReference ?? 0, 2));
      // The item's file position is base_offset + extent_offset. With both
      // fields present the base is where mdat's data starts; with only one,
      // that one carries the whole position.
      const split = baseOffsetSize > 0 && offsetSize > 0;
      const base = baseOffsetSize === 0 ? 0 : split ? mdatStart : mdatStart + offset;
      const extent = baseOffsetSize === 0 ? mdatStart + offset : split ? offset : 0;
      rows.push(...uint(base, baseOffsetSize));
      // One extent, with an extent_index first when index_size says so.
      rows.push(0, 1);
      rows.push(...uint(0, indexSize));
      rows.push(...uint(extent, offsetSize));
      rows.push(...uint(item.data.length + (o.lengthSlack ?? 0), lengthSize));
      offset += item.data.length;
    }
    const iloc = box(
      "iloc",
      Uint8Array.of(version, 0, 0, 0),
      Uint8Array.of((offsetSize << 4) | lengthSize, (baseOffsetSize << 4) | indexSize),
      Uint8Array.of(...uint(items.length, wide ? 4 : 2)),
      Uint8Array.of(...rows),
    );
    const pitm = primary === null ? new Uint8Array(0) : box("pitm", Uint8Array.of(pitmVersion, 0, 0, 0, ...uint(primary, pitmVersion === 0 ? 2 : 4)));
    const hdlr = box("hdlr", new Uint8Array(25));
    const iprp = box("iprp", box("ipco", ispe(), nclxColr()));
    return box("meta", new Uint8Array(4), hdlr, pitm, o.withIloc === false ? new Uint8Array(0) : iloc, iprp);
  };

  // The iloc and pitm have fixed sizes, so a first pass fixes where mdat starts.
  const head = ftyp();
  const mdatStart = head.length + build(0).length + 8;
  return concat(head, build(mdatStart), box("mdat", ...items.map((i) => i.data)));
}
