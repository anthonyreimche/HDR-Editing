import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { encodeGreyJpeg, qualityTable } from "../src/jpeg-encode";
import { ascii, concat, jpegSize, parseJpeg, payloadOf, segment, startsWith } from "../src/jpeg";

function gradient(w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round((255 * (x + y)) / (w + h - 2));
  return g;
}

function psnr(a: ArrayLike<number>, b: Uint8Array, stride: number): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i * stride]) ** 2;
  return 10 * Math.log10((255 * 255) / (se / a.length));
}

describe("encodeGreyJpeg", () => {
  it("writes a single-component baseline JPEG", () => {
    const bytes = encodeGreyJpeg(gradient(64, 48), 64, 48, 90);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
    const sof = parseJpeg(bytes).segments.find((s) => s.marker === 0xc0)!;
    expect(payloadOf(bytes, sof)[5]).toBe(1);
    expect(jpegSize(bytes)).toEqual({ width: 64, height: 48 });
  });

  it("decodes to its input within JPEG error", () => {
    const grey = gradient(64, 48);
    const decoded = jpeg.decode(encodeGreyJpeg(grey, 64, 48, 90), { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([64, 48]);
    expect(psnr(grey, decoded.data, 4)).toBeGreaterThan(40);
  });

  it("handles sizes that aren't multiples of 8 and flat images", () => {
    const flat = new Uint8Array(37 * 29).fill(200);
    const decoded = jpeg.decode(encodeGreyJpeg(flat, 37, 29, 90), { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([37, 29]);
    for (let i = 0; i < 37 * 29; i++) expect(Math.abs(decoded.data[i * 4] - 200)).toBeLessThanOrEqual(1);
  });

  it("survives extreme content at quality 100", () => {
    const checker = new Uint8Array(32 * 32);
    for (let i = 0; i < checker.length; i++) checker[i] = ((i % 32) + (i >> 5)) % 2 ? 255 : 0;
    const decoded = jpeg.decode(encodeGreyJpeg(checker, 32, 32, 100), { useTArray: true });
    expect(psnr(checker, decoded.data, 4)).toBeGreaterThan(30);
  });

  it("scales the Annex K table the way libjpeg does", () => {
    expect(Array.from(qualityTable(50)).slice(0, 8)).toEqual([16, 11, 10, 16, 24, 40, 51, 61]);
    expect(Array.from(qualityTable(100)).every((v) => v === 1)).toBe(true);
  });
});

describe("JPEG segments", () => {
  it("builds and finds an APP segment, then the scan", () => {
    const base = encodeGreyJpeg(gradient(16, 16), 16, 16, 90);
    const app = segment(0xe1, ascii("Exif\0\0abc"));
    const withApp = new Uint8Array([...base.subarray(0, 2), ...app, ...base.subarray(2)]);
    const { segments, scan } = parseJpeg(withApp);
    expect(segments[0]).toMatchObject({ marker: 0xe1, start: 2, end: 2 + app.length });
    expect(startsWith(payloadOf(withApp, segments[0]), ascii("Exif\0\0"))).toBe(true);
    expect([withApp[scan], withApp[scan + 1]]).toEqual([0xff, 0xda]);
  });

  it("refuses a file that isn't a JPEG", () => {
    expect(() => parseJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The expectations below are written out independently of src/ (ITU-T T.81
// tables, hand-derived bit strings) so a slip
// in the encoder's own constants can't also move the expectation.

/** Table K.1, row-major. */
const K1_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
];

/** Figure A.6: the anti-diagonals in turn, odd ones top-right to bottom-left and even ones back. */
const ZIGZAG: number[] = [];
for (let s = 0; s < 15; s++) {
  const rows: number[] = [];
  for (let r = Math.max(0, s - 7); r <= Math.min(7, s); r++) rows.push(r);
  if (s % 2 === 0) rows.reverse();
  for (const r of rows) ZIGZAG.push(r * 8 + (s - r));
}

/** libjpeg's quality-to-scale factor for the qualities these tests use (5000/q below 50, else 200 - 2q). */
const SCALE: Record<number, number> = { 1: 5000, 10: 500, 25: 200, 30: 166, 50: 100, 75: 50, 90: 20, 100: 0 };
const expectedTable = (q: number): number[] =>
  K1_LUMA.map((v) => Math.min(255, Math.max(1, Math.floor((v * SCALE[q] + 50) / 100))));

// Table K.3 (DC) and K.5 (AC), luminance: code counts per length, then the symbols.
const K3_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const K3_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const K5_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const K5_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

const SOI = Uint8Array.of(0xff, 0xd8);
const EOI = Uint8Array.of(0xff, 0xd9);
const SOS = segment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0));

/** An SOF-style segment: 8-bit precision, one component, the given size. */
const sof = (marker: number, width: number, height: number): Uint8Array =>
  segment(marker, Uint8Array.of(8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0));

/** SOI, the given header segments, an SOS header and a stub scan. */
const headerFile = (...parts: Uint8Array[]): Uint8Array => concat([SOI, ...parts, SOS, Uint8Array.of(0x12, 0x34), EOI]);

function noise(w: number, h: number, seed: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

function maxError(a: ArrayLike<number>, b: Uint8Array, stride: number): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i * stride]));
  return m;
}

/** The entropy-coded bytes: everything between the SOS header and EOI. */
function scanData(bytes: Uint8Array): Uint8Array {
  const { scan } = parseJpeg(bytes);
  const headerLength = (bytes[scan + 2] << 8) | bytes[scan + 3];
  return bytes.subarray(scan + 2 + headerLength, bytes.length - 2);
}

interface HuffmanTable {
  cls: number;
  id: number;
  bits: number[];
  vals: number[];
}

function readHuffmanTables(bytes: Uint8Array): HuffmanTable[] {
  const tables: HuffmanTable[] = [];
  for (const s of parseJpeg(bytes).segments) {
    if (s.marker !== 0xc4) continue;
    const p = payloadOf(bytes, s);
    let at = 0;
    while (at < p.length) {
      const bits = Array.from(p.subarray(at + 1, at + 17));
      const n = bits.reduce((a, b) => a + b, 0);
      tables.push({ cls: p[at] >> 4, id: p[at] & 15, bits, vals: Array.from(p.subarray(at + 17, at + 17 + n)) });
      at += 17 + n;
    }
  }
  return tables;
}

/**
 * Decodes the AC run/size symbols of the first block of a one-block scan with
 * the Annex K tables, so a test can see which symbols the encoder chose (e.g.
 * ZRL) without relying on a decoder that would also accept a lucky wrong one.
 */
function firstBlockAcSymbols(data: Uint8Array): number[] {
  const unstuffed: number[] = [];
  for (let i = 0; i < data.length; i++) {
    unstuffed.push(data[i]);
    if (data[i] === 0xff && data[i + 1] === 0x00) i++;
  }
  const codes = (bits: readonly number[], vals: readonly number[]) => {
    const map = new Map<string, number>();
    let code = 0;
    let k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < bits[len - 1]; i++) map.set(`${len}:${code++}`, vals[k++]);
      code <<= 1;
    }
    return map;
  };
  const dc = codes(K3_BITS, K3_VALS);
  const ac = codes(K5_BITS, K5_VALS);
  let pos = 0;
  const bit = () => (unstuffed[pos >> 3] >> (7 - (pos++ & 7))) & 1;
  const symbol = (table: Map<string, number>): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | bit();
      const v = table.get(`${len}:${code}`);
      if (v !== undefined) return v;
    }
    throw new Error("no Huffman code matches");
  };
  // Not `pos += symbol(dc)`: that reads pos before symbol() advances it.
  const dcSize = symbol(dc);
  pos += dcSize;
  const symbols: number[] = [];
  let k = 1;
  while (k < 64) {
    const s = symbol(ac);
    symbols.push(s);
    if (s === 0x00) break;
    if (s === 0xf0) {
      k += 16;
      continue;
    }
    k += (s >> 4) + 1;
    pos += s & 15;
  }
  return symbols;
}

describe("encodeGreyJpeg round trips", () => {
  it.each([
    [64, 48],
    [61, 45],
    [37, 29],
  ])("keeps x and y apart on a %ix%i ramp", (w, h) => {
    // Each ramp has energy along one DCT axis only, so a transposed transform,
    // or a swapped row/column edge clamp on a partial block, cannot hide.
    const xRamp = new Uint8Array(w * h);
    const yRamp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        xRamp[y * w + x] = Math.round((255 * x) / (w - 1));
        yRamp[y * w + x] = Math.round((255 * y) / (h - 1));
      }
    }
    for (const ramp of [xRamp, yRamp]) {
      const decoded = jpeg.decode(encodeGreyJpeg(ramp, w, h, 90), { useTArray: true });
      expect([decoded.width, decoded.height]).toEqual([w, h]);
      // Measured: 1 on every size here, PSNR 51 dB and up.
      expect(maxError(ramp, decoded.data, 4)).toBeLessThanOrEqual(2);
      expect(psnr(ramp, decoded.data, 4)).toBeGreaterThan(45);
    }
  });

  it("round-trips seeded noise at quality 100 pixel by pixel", () => {
    const grey = noise(45, 37, 7);
    const decoded = jpeg.decode(encodeGreyJpeg(grey, 45, 37, 100), { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([45, 37]);
    // Measured: max error 1, PSNR 58.3 dB.
    expect(maxError(grey, decoded.data, 4)).toBeLessThanOrEqual(2);
    expect(psnr(grey, decoded.data, 4)).toBeGreaterThan(50);
  });

  it("keeps every byte when the scan outgrows the writer's first buffer", () => {
    // A real gain map's scan runs to megabytes; noise at quality 100 passes
    // 64 KB quickly, so the writer has to grow and copy what it holds.
    const grey = noise(256, 256, 11);
    const file = encodeGreyJpeg(grey, 256, 256, 100);
    expect(file.length).toBeGreaterThan(65536);
    const decoded = jpeg.decode(file, { useTArray: true });
    expect(maxError(grey, decoded.data, 4)).toBeLessThanOrEqual(2);
  });

  it.each([
    [25, 40],
    [10, 32],
    [1, 22],
  ])("still reconstructs a diagonal ramp at quality %i (PSNR above %i dB)", (quality, floor) => {
    // Measured PSNR: 44.3, 35.8 and 26.5 dB. The point is that the quantiser and
    // the emitted DQT agree when the table is scaled up and clamped at 255.
    const w = 61;
    const h = 45;
    const ramp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp[y * w + x] = Math.round((255 * (x + y)) / (w + h - 2));
    const decoded = jpeg.decode(encodeGreyJpeg(ramp, w, h, quality), { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([w, h]);
    expect(psnr(ramp, decoded.data, 4)).toBeGreaterThan(floor);
  });
});

describe("qualityTable", () => {
  it.each([1, 10, 25, 30, 50, 75, 90, 100])("matches libjpeg's scaling at quality %i", (q) => {
    expect(Array.from(qualityTable(q))).toEqual(expectedTable(q));
  });

  it("matches libjpeg's published first rows", () => {
    const row = (q: number) => Array.from(qualityTable(q)).slice(0, 8);
    expect(row(90)).toEqual([3, 2, 2, 3, 5, 8, 10, 12]);
    expect(row(75)).toEqual([8, 6, 5, 8, 12, 20, 26, 31]);
    expect(row(25)).toEqual([32, 22, 20, 32, 48, 80, 102, 122]);
    // Past 255 an entry is clamped, not wrapped into a byte.
    expect(row(10)).toEqual([80, 55, 50, 80, 120, 200, 255, 255]);
    expect(Array.from(qualityTable(1)).every((v) => v === 255)).toBe(true);
  });

  it("clamps and rounds the quality it is given", () => {
    expect(Array.from(qualityTable(0))).toEqual(Array.from(qualityTable(1)));
    expect(Array.from(qualityTable(-20))).toEqual(Array.from(qualityTable(1)));
    expect(Array.from(qualityTable(1000))).toEqual(Array.from(qualityTable(100)));
    expect(Array.from(qualityTable(89.6))).toEqual(Array.from(qualityTable(90)));
    expect(Array.from(qualityTable(89.4))).toEqual(Array.from(qualityTable(89)));
  });
});

describe("encodeGreyJpeg structure", () => {
  it("is checked against a zigzag reference that is itself right", () => {
    expect(ZIGZAG.slice(0, 10)).toEqual([0, 1, 8, 16, 9, 2, 3, 10, 17, 24]);
    expect(ZIGZAG.slice(-4)).toEqual([47, 55, 62, 63]);
    expect(new Set(ZIGZAG).size).toBe(64);
  });

  it.each([90, 25, 1])("writes the quality-%i table in zigzag order", (q) => {
    const bytes = encodeGreyJpeg(gradient(16, 16), 16, 16, q);
    const dqt = parseJpeg(bytes).segments.filter((s) => s.marker === 0xdb);
    expect(dqt).toHaveLength(1);
    const p = payloadOf(bytes, dqt[0]);
    expect(p).toHaveLength(65);
    // Pq = 0 (8-bit entries), Tq = 0.
    expect(p[0]).toBe(0x00);
    const table = expectedTable(q);
    expect(Array.from(p.subarray(1))).toEqual(ZIGZAG.map((n) => table[n]));
  });

  it("emits the standard Annex K luminance Huffman tables", () => {
    const bytes = encodeGreyJpeg(gradient(16, 16), 16, 16, 90);
    expect(K3_BITS.reduce((a, b) => a + b, 0)).toBe(K3_VALS.length);
    expect(K5_BITS.reduce((a, b) => a + b, 0)).toBe(162);
    expect(K5_VALS).toHaveLength(162);
    expect(readHuffmanTables(bytes)).toEqual([
      { cls: 0, id: 0, bits: K3_BITS, vals: K3_VALS },
      { cls: 1, id: 0, bits: K5_BITS, vals: K5_VALS },
    ]);
  });

  it("writes JFIF, DQT, SOF0, DHT, then an SOS for one component", () => {
    const bytes = encodeGreyJpeg(new Uint8Array(300 * 520).fill(90), 300, 520, 90);
    const { segments, scan } = parseJpeg(bytes);
    expect(segments.map((s) => s.marker)).toEqual([0xe0, 0xdb, 0xc0, 0xc4]);
    // "JFIF\0", version 1.1, no density unit, 1:1, no thumbnail.
    expect(Array.from(payloadOf(bytes, segments[0]))).toEqual([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    // Precision 8, height 520 = 0x0208, width 300 = 0x012c, one component with id 1,
    // 1x1 sampling and quantisation table 0.
    expect(Array.from(payloadOf(bytes, segments[2]))).toEqual([8, 0x02, 0x08, 0x01, 0x2c, 1, 1, 0x11, 0]);
    expect(jpegSize(bytes)).toEqual({ width: 300, height: 520 });
    // Length 8, one component (id 1) on Huffman tables 0/0, Ss = 0, Se = 63, Ah/Al = 0.
    expect(Array.from(bytes.subarray(scan, scan + 10))).toEqual([0xff, 0xda, 0x00, 0x08, 1, 1, 0x00, 0, 63, 0]);
  });
});

describe("encodeGreyJpeg entropy-coded data", () => {
  it("codes a flat mid-grey block as DC category 0 + EOB, padded with 1 bits", () => {
    // DC cat 0 = 00, EOB = 1010, then two 1s to fill the byte: 0010 1011.
    expect(Array.from(scanData(encodeGreyJpeg(new Uint8Array(64).fill(128), 8, 8, 90)))).toEqual([0x2b]);
  });

  it("rounds the DC coefficient to nearest, not toward zero or down", () => {
    // White: DC = 8·127 = 1016, /3 = 338.67 -> 339 (cat 9, 101010011). Code 1111110 +
    // 101010011 + EOB 1010 + four 1s: 1111 1101 0101 0011 1010 1111.
    expect(Array.from(scanData(encodeGreyJpeg(new Uint8Array(64).fill(255), 8, 8, 90)))).toEqual([0xfd, 0x53, 0xaf]);
    // Black: DC = -1024, /3 = -341.33 -> -341, stored as -341 + 511 = 170 (010101010). Code
    // 1111110 + 010101010 + EOB + four 1s: 1111 1100 1010 1010 1010 1111.
    expect(Array.from(scanData(encodeGreyJpeg(new Uint8Array(64), 8, 8, 90)))).toEqual([0xfc, 0xaa, 0xaf]);
  });

  it("uses ZRL for a run of 16 or more zeros before the last coefficient", () => {
    // Only coefficient (7,7), the last in zigzag order, is nonzero: 62 zeros
    // precede it, so the encoder must emit three ZRL (0xF0) and then a run of 14.
    // 4·124 = 496, /99 (the quality-50 entry) = 5.01 -> 5, category 3. The
    // quantiser's step is large enough that rounding noise in the pixels can't
    // flip any other coefficient off zero.
    const block = new Uint8Array(64);
    const basis = (i: number) => Math.cos(((2 * i + 1) * 7 * Math.PI) / 16);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) block[y * 8 + x] = Math.round(128 + 124 * basis(x) * basis(y));
    }
    const bytes = encodeGreyJpeg(block, 8, 8, 50);
    expect(firstBlockAcSymbols(scanData(bytes))).toEqual([0xf0, 0xf0, 0xf0, 0xe3]);
    const decoded = jpeg.decode(bytes, { useTArray: true });
    expect(maxError(block, decoded.data, 4)).toBeLessThanOrEqual(2);
  });

  it("stuffs a zero after every 0xFF byte and never lets a marker into the scan", () => {
    const bytes = encodeGreyJpeg(noise(45, 37, 7), 45, 37, 100);
    const data = scanData(bytes);
    let ff = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0xff) continue;
      ff++;
      expect(data[i + 1]).toBe(0x00);
    }
    // Not vacuous: this noise image contains 29 of them.
    expect(ff).toBeGreaterThan(0);
  });
});

describe("JPEG segment parsing edge cases", () => {
  const app = segment(0xe1, ascii("abc"));

  it("skips fill bytes before a marker and before the scan", () => {
    const filled = concat([SOI, Uint8Array.of(0xff, 0xff), app, Uint8Array.of(0xff, 0xff), SOS, EOI]);
    const { segments, scan } = parseJpeg(filled);
    // The segment starts at its own 0xFF, after the two fill bytes.
    expect(segments).toEqual([{ marker: 0xe1, start: 4, end: 4 + app.length }]);
    // Likewise the scan is at the SOS marker's own 0xFF, after the next two.
    expect(scan).toBe(2 + 2 + app.length + 2);
    expect([filled[scan], filled[scan + 1]]).toEqual([0xff, 0xda]);
  });

  it.each([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])(
    "treats marker %i as a two-byte standalone segment",
    (marker) => {
      const { segments } = parseJpeg(headerFile(Uint8Array.of(0xff, marker), app));
      expect(segments).toEqual([
        { marker, start: 2, end: 4 },
        { marker: 0xe1, start: 4, end: 4 + app.length },
      ]);
    },
  );

  it.each([0xcf, 0xd8])("reads a length for marker %i, the neighbours of the RSTn range", (marker) => {
    const odd = segment(marker, Uint8Array.of(1, 2, 3));
    const { segments } = parseJpeg(headerFile(odd, app));
    expect(segments).toEqual([
      { marker, start: 2, end: 2 + odd.length },
      { marker: 0xe1, start: 2 + odd.length, end: 2 + odd.length + app.length },
    ]);
  });

  it("throws on a segment that claims more bytes than the file has", () => {
    // Declared length 5 but only 2 payload bytes follow: one byte past the end.
    const overrun = concat([SOI, Uint8Array.of(0xff, 0xe1, 0x00, 0x05, 0x61, 0x62)]);
    expect(() => parseJpeg(overrun)).toThrow(/runs past the end/);
    expect(jpegSize(overrun)).toBeNull();
  });

  it("accepts a segment ending exactly at the end of the file, then finds no scan", () => {
    const exact = concat([SOI, Uint8Array.of(0xff, 0xe1, 0x00, 0x04, 0x61, 0x62)]);
    expect(() => parseJpeg(exact)).toThrow(/no scan/);
  });

  it.each([
    [0x00, 4],
    [0x01, 5],
  ])("rejects a segment length of %i", (length, at) => {
    // A length under 2 can't even cover its own length field; the parser then
    // lands on a non-marker byte and refuses the file.
    const bad = concat([SOI, Uint8Array.of(0xff, 0xe1, 0x00, length), SOS, EOI]);
    expect(() => parseJpeg(bad)).toThrow(`no JPEG marker at byte ${at}`);
  });

  it("refuses bytes where a marker should start", () => {
    expect(() => parseJpeg(concat([SOI, Uint8Array.of(1, 2, 3, 4), SOS, EOI]))).toThrow(/no JPEG marker at byte 2/);
  });

  it("checks the SOI signature and a minimum length", () => {
    expect(() => parseJpeg(Uint8Array.of(0xff, 0xd8, 0xff))).toThrow(/not a JPEG/);
    expect(() => parseJpeg(Uint8Array.of(0xff, 0xd9, 0xff, 0xda))).toThrow(/not a JPEG/);
    expect(() => parseJpeg(Uint8Array.of(0x00, 0xd8, 0xff, 0xda))).toThrow(/not a JPEG/);
  });

  it("finds a scan with only its length bytes after the marker, but not a shorter stub", () => {
    expect(parseJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02))).toEqual({ segments: [], scan: 2 });
    expect(() => parseJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0x00))).toThrow(/no scan/);
  });

  it("returns the exact payload of a built segment", () => {
    const built = segment(0xe2, Uint8Array.of(9, 8, 7));
    expect(Array.from(built)).toEqual([0xff, 0xe2, 0x00, 0x05, 9, 8, 7]);
    const file = headerFile(built);
    const s = parseJpeg(file).segments[0];
    expect(Array.from(payloadOf(file, s))).toEqual([9, 8, 7]);
  });

  it("builds the longest legal segment and refuses one byte more", () => {
    expect(segment(0xe1, new Uint8Array(65533)).subarray(0, 4)).toEqual(Uint8Array.of(0xff, 0xe1, 0xff, 0xff));
    expect(() => segment(0xe1, new Uint8Array(65534))).toThrow(/too long/);
  });

  it("concatenates in order, and nothing to nothing", () => {
    expect(Array.from(concat([Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)]))).toEqual([1, 2, 3]);
    expect(concat([])).toHaveLength(0);
    expect(Array.from(ascii("Exif\0\0"))).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0]);
  });
});

describe("jpegSize", () => {
  const real = sof(0xc0, 321, 258);

  it.each([0xc4, 0xc8, 0xcc])("does not mistake marker %i for a frame header", (decoy) => {
    // The decoy's payload looks like an SOF for a 0x2222 x 0x1111 image and
    // comes first; DHT, JPG and DAC are the three in the SOF range that aren't SOFs.
    const lure = segment(decoy, Uint8Array.of(8, 0x11, 0x11, 0x22, 0x22, 1, 1, 0x11, 0));
    expect(jpegSize(headerFile(lure, real))).toEqual({ width: 321, height: 258 });
  });

  it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
    "reads the size from SOF marker %i",
    (marker) => {
      expect(jpegSize(headerFile(sof(marker, 321, 258)))).toEqual({ width: 321, height: 258 });
    },
  );

  it("is null without a frame header or without a scan", () => {
    expect(jpegSize(headerFile(segment(0xe1, ascii("x"))))).toBeNull();
    expect(jpegSize(encodeGreyJpeg(gradient(16, 16), 16, 16, 90).subarray(0, 20))).toBeNull();
  });
});

describe("startsWith", () => {
  const prefix = ascii("Exif\0\0");

  it("is true for an equal prefix, an exact match and an empty prefix", () => {
    expect(startsWith(ascii("Exif\0\0abc"), prefix)).toBe(true);
    expect(startsWith(prefix, prefix)).toBe(true);
    expect(startsWith(prefix, new Uint8Array(0))).toBe(true);
  });

  it("is false when any byte differs, including only the last", () => {
    expect(startsWith(ascii("Exif\0\u0001abc"), prefix)).toBe(false);
    expect(startsWith(ascii("Exie\0\0abc"), prefix)).toBe(false);
    expect(startsWith(ascii("Fxif\0\0abc"), prefix)).toBe(false);
  });

  it("is false when the bytes are shorter than the prefix", () => {
    expect(startsWith(ascii("Exif\0"), prefix)).toBe(false);
  });
});
