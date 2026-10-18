// A minimal ISOBMFF tree shaped like jSquash's AVIF: ftyp, meta (FullBox) >
// hdlr, iprp > ipco > ispe, colr nclx (2, 2, 6, full range), then mdat.

const enc = (s: string) => new TextEncoder().encode(s);

export function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 8 + children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(enc(type), 4);
  let at = 8;
  for (const c of children) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A box with the 64-bit "largesize" header (size field 1, then 8 bytes). */
export function largeBox(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(16 + body);
  const view = new DataView(out.buffer);
  view.setUint32(0, 1);
  out.set(enc(type), 4);
  view.setBigUint64(8, BigInt(out.length));
  let at = 16;
  for (const c of children) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const ftyp = (): Uint8Array => box("ftyp", enc("avif"), new Uint8Array(4), enc("avifmif1"));
export const ispe = (): Uint8Array => box("ispe", new Uint8Array(12));
export const nclxColr = (): Uint8Array => box("colr", enc("nclx"), Uint8Array.of(0, 2, 0, 2, 0, 6, 0x80));

/** A meta box whose ipco holds `ipcoChildren`; `wrap` picks the box header form. */
export function metaWith(ipcoChildren: Uint8Array[], wrap: typeof box = box): Uint8Array {
  return wrap("meta", new Uint8Array(4), box("hdlr", new Uint8Array(25)), box("iprp", box("ipco", ...ipcoChildren)));
}

export function avifLike(withColr = true): Uint8Array {
  const colr = box("colr", enc("nclx"), Uint8Array.of(0, 2, 0, 2, 0, 6, 0x80));
  const ipco = withColr ? box("ipco", box("ispe", new Uint8Array(12)), colr) : box("ipco", box("ispe", new Uint8Array(12)));
  const meta = box("meta", new Uint8Array(4), box("hdlr", new Uint8Array(25)), box("iprp", ipco));
  return new Uint8Array([...box("ftyp", enc("avif"), new Uint8Array(4), enc("avifmif1")), ...meta, ...box("mdat", new Uint8Array(16))]);
}
