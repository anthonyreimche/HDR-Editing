// An Ultra HDR JPEG (Android Ultra HDR v1.1, Adobe gain map, ISO 21496-1):
// the core's SDR JPEG as the primary image and a greyscale gain-map JPEG
// appended after it, found through an MPF index (Chrome finds gain maps only
// through MPF). Both metadata forms are written; readers prefer ISO.
//
// Layout, from libultrahdr's encoder and Skia's reader:
//   primary  SOI, [JFIF], [Exif], XMP (GContainer + hdrgm:Version), [ICC],
//            ISO 21496-1 version box, the base's tables, MPF, SOS…EOI
//   gain map SOI, XMP (hdrgm), ISO 21496-1 metadata, the encoder's segments

import { ascii, concat, parseJpeg, payloadOf, segment, startsWith, type Segment } from "./jpeg";
import { OFFSET, quantizeHeadroom } from "./model";

export const XMP_NS = ascii("http://ns.adobe.com/xap/1.0/\0");
export const ISO_NS = ascii("urn:iso:std:iso:ts:21496:-1\0");
export const MPF_SIG = ascii("MPF\0");
const EXIF = ascii("Exif\0\0");
const ICC = ascii("ICC_PROFILE\0");
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const MPF_LENGTH = 90;

/** A number as C++ streams print it by default (six significant digits). */
export const fmt = (v: number): string => String(Number(v.toPrecision(6)));

export function primaryXmp(gainMapLength: number): string {
  return [
    "<x:xmpmeta",
    '  xmlns:x="adobe:ns:meta/"',
    '  x:xmptk="Adobe XMP Core 5.1.2">',
    "  <rdf:RDF",
    '    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    "    <rdf:Description",
    '      xmlns:Container="http://ns.google.com/photos/1.0/container/"',
    '      xmlns:Item="http://ns.google.com/photos/1.0/container/item/"',
    '      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"',
    '      hdrgm:Version="1.0">',
    "      <Container:Directory>",
    "        <rdf:Seq>",
    "          <rdf:li",
    '            rdf:parseType="Resource">',
    "            <Container:Item",
    '              Item:Semantic="Primary"',
    '              Item:Mime="image/jpeg"/>',
    "          </rdf:li>",
    "          <rdf:li",
    '            rdf:parseType="Resource">',
    "            <Container:Item",
    '              Item:Semantic="GainMap"',
    '              Item:Mime="image/jpeg"',
    `              Item:Length="${gainMapLength}"/>`,
    "          </rdf:li>",
    "        </rdf:Seq>",
    "      </Container:Directory>",
    "    </rdf:Description>",
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    "",
  ].join("\n");
}

export function gainMapXmp(headroom: number): string {
  return [
    "<x:xmpmeta",
    '  xmlns:x="adobe:ns:meta/"',
    '  x:xmptk="Adobe XMP Core 5.1.2">',
    "  <rdf:RDF",
    '    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    "    <rdf:Description",
    '      rdf:about=""',
    '      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"',
    '      hdrgm:Version="1.0"',
    '      hdrgm:GainMapMin="0"',
    `      hdrgm:GainMapMax="${fmt(headroom)}"`,
    '      hdrgm:Gamma="1"',
    `      hdrgm:OffsetSDR="${fmt(OFFSET)}"`,
    `      hdrgm:OffsetHDR="${fmt(OFFSET)}"`,
    '      hdrgm:HDRCapacityMin="0"',
    `      hdrgm:HDRCapacityMax="${fmt(headroom)}"`,
    '      hdrgm:BaseRenditionIsHDR="False"/>',
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    "",
  ].join("\n");
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A headroom quantised to tenths as an exact fraction in lowest terms. */
export function fraction(v: number): [number, number] {
  const n = Math.round(v * 10);
  const g = gcd(n, 10);
  return [n / g, 10 / g];
}

export function isoVersionSegment(): Uint8Array {
  return segment(APP2, new Uint8Array([...ISO_NS, 0, 0, 0, 0]));
}

/** ISO 21496-1 metadata: one channel, the base colour space, independent
 *  N/D pairs (the common-denominator form is reserved), big-endian. */
export function isoGainMapPayload(headroom: number): Uint8Array {
  const out = new Uint8Array(61);
  const view = new DataView(out.buffer);
  const [hn, hd] = fraction(headroom);
  view.setUint16(0, 0); // minimum_version
  view.setUint16(2, 0); // writer_version
  out[4] = 0x40; // use_base_colour_space
  const pairs: [number, number][] = [
    [0, 1], // base_hdr_headroom
    [hn, hd], // alternate_hdr_headroom
    [0, 1], // gain_map_min
    [hn, hd], // gain_map_max
    [1, 1], // gamma
    [1, 64], // base_offset
    [1, 64], // alternate_offset
  ];
  pairs.forEach(([n, d], i) => {
    view.setUint32(5 + i * 8, n >>> 0);
    view.setUint32(9 + i * 8, d);
  });
  return out;
}

/** The MPF index (CIPA DC-007), big-endian; offsets count from the byte
 *  after "MPF\0", and the primary's is 0. */
export function mpfSegment(primarySize: number, gainMapSize: number, gainMapOffset: number): Uint8Array {
  const body = new Uint8Array(MPF_LENGTH - 4);
  const view = new DataView(body.buffer);
  body.set(MPF_SIG, 0);
  body.set([0x4d, 0x4d, 0x00, 0x2a], 4);
  view.setUint32(8, 8);
  view.setUint16(12, 3);
  view.setUint16(14, 0xb000);
  view.setUint16(16, 7);
  view.setUint32(18, 4);
  body.set(ascii("0100"), 22);
  view.setUint16(26, 0xb001);
  view.setUint16(28, 4);
  view.setUint32(30, 1);
  view.setUint32(34, 2);
  view.setUint16(38, 0xb002);
  view.setUint16(40, 7);
  view.setUint32(42, 32);
  view.setUint32(46, 50);
  view.setUint32(50, 0);
  view.setUint32(54, 0x00030000);
  view.setUint32(58, primarySize);
  view.setUint32(62, 0);
  view.setUint32(70, 0);
  view.setUint32(74, gainMapSize);
  view.setUint32(78, gainMapOffset);
  return segment(APP2, body);
}

function kind(bytes: Uint8Array, s: Segment): "jfif" | "exif" | "icc" | "drop" | "keep" | "table" {
  const p = payloadOf(bytes, s);
  if (s.marker === APP0) return "jfif";
  if (s.marker === APP1 && startsWith(p, EXIF)) return "exif";
  if (s.marker === APP2 && startsWith(p, ICC)) return "icc";
  if (s.marker === APP13) return "keep";
  if (s.marker >= 0xe0 && s.marker <= 0xef) return "drop"; // old XMP, MPF, ISO, others
  return "table";
}

/** Just past the first EOI after the scan header. Every 0xFF in entropy-coded
 *  data is followed by 0x00 or an RSTn, so the first FF D9 is the image's own
 *  EOI; anything after it (a gain map from an earlier assembly) is not part of
 *  the primary. */
function endOfImage(bytes: Uint8Array, scan: number): number {
  const headerEnd = scan + 2 + ((bytes[scan + 2] << 8) | bytes[scan + 3]);
  for (let i = headerEnd; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2;
  }
  throw new Error("[hdr-editing] JPEG has no end of image");
}

/** The headroom is quantised here because the gain map was normalised by the
 *  quantised value: stating any other would mis-scale the HDR rendition, and
 *  the XMP and ISO forms would round differently. */
export function assembleUltraHdr(sdrJpeg: Uint8Array, gainJpeg: Uint8Array, headroom: number): Uint8Array {
  if (!Number.isFinite(headroom)) throw new Error(`[hdr-editing] headroom ${headroom} is not a number`);
  if (gainJpeg.length < 2 || gainJpeg[0] !== 0xff || gainJpeg[1] !== 0xd8) {
    throw new Error("[hdr-editing] the gain map is not a JPEG");
  }
  const h = quantizeHeadroom(headroom);
  const gainMap = concat([
    Uint8Array.of(0xff, 0xd8),
    segment(APP1, new Uint8Array([...XMP_NS, ...ascii(gainMapXmp(h))])),
    segment(APP2, new Uint8Array([...ISO_NS, ...isoGainMapPayload(h)])),
    gainJpeg.subarray(2),
  ]);

  const { segments, scan } = parseJpeg(sdrJpeg);
  const of = (k: ReturnType<typeof kind>) =>
    segments.filter((s) => kind(sdrJpeg, s) === k).map((s) => sdrJpeg.subarray(s.start, s.end));
  const head = concat([
    Uint8Array.of(0xff, 0xd8),
    ...of("jfif"),
    ...of("exif"),
    segment(APP1, new Uint8Array([...XMP_NS, ...ascii(primaryXmp(gainMap.length))])),
    ...of("icc"),
    isoVersionSegment(),
    ...of("keep"),
    ...of("table"),
  ]);
  const scanData = sdrJpeg.subarray(scan, endOfImage(sdrJpeg, scan));
  const primarySize = head.length + MPF_LENGTH + scanData.length;
  const mpf = mpfSegment(primarySize, gainMap.length, primarySize - (head.length + 8));
  return concat([head, mpf, scanData, gainMap]);
}
