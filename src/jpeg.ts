// Just enough JPEG structure to rebuild a file around its scan: the marker
// segments before the first SOS, and a builder for new ones.

export interface Segment {
  marker: number;
  /** Offset of the segment's 0xFF. */
  start: number;
  /** Offset just past it. */
  end: number;
}

export function parseJpeg(bytes: Uint8Array): { segments: Segment[]; scan: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("[hdr-editing] not a JPEG");
  const segments: Segment[] = [];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) throw new Error(`[hdr-editing] no JPEG marker at byte ${pos}`);
    let at = pos;
    while (bytes[at + 1] === 0xff) at++;
    const marker = bytes[at + 1];
    if (marker === 0xda) return { segments, scan: at };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start: at, end: at + 2 });
      pos = at + 2;
      continue;
    }
    const end = at + 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    if (end > bytes.length) throw new Error("[hdr-editing] JPEG segment runs past the end");
    segments.push({ marker, start: at, end });
    pos = end;
  }
  throw new Error("[hdr-editing] JPEG has no scan");
}

const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const { segments } = parseJpeg(bytes);
    const sof = segments.find((s) => isSof(s.marker));
    if (!sof) return null;
    const o = sof.start + 4;
    return { height: (bytes[o + 1] << 8) | bytes[o + 2], width: (bytes[o + 3] << 8) | bytes[o + 4] };
  } catch {
    return null;
  }
}

export function payloadOf(bytes: Uint8Array, s: Segment): Uint8Array {
  return bytes.subarray(s.start + 4, s.end);
}

export function segment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error("[hdr-editing] JPEG segment too long");
  const out = new Uint8Array(len + 2);
  out.set([0xff, marker, len >> 8, len & 0xff]);
  out.set(payload, 4);
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

export function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}
