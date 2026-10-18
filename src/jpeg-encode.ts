// A baseline greyscale (one-component) JPEG encoder for gain maps. The
// canvas encoder only writes three-component YCbCr, and some gain-map readers
// expect one channel. Standard luminance tables (ITU-T T.81 Annex K), a
// separable floating-point DCT, libjpeg's quality scaling.

import { concat, segment } from "./jpeg";

/** ZIGZAG[k] is the row-major index of the k-th coefficient in zigzag order. */
const ZIGZAG = Int32Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63,
]);

/** Annex K.1 luminance quantisation table, row-major. */
const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
];

// Annex K.3 luminance Huffman tables.
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
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

/** C[u·8 + x] = c(u)/2 · cos((2x + 1)uπ/16), so F = C·f·Cᵀ is the JPEG DCT. */
const C = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) C[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2;
}

/** libjpeg's jpeg_quality_scaling over the Annex K table, row-major. */
export function qualityTable(quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return Uint8Array.from(LUMA_Q, (v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

interface Huffman {
  code: Uint16Array;
  size: Uint8Array;
}

function huffman(bits: readonly number[], vals: readonly number[]): Huffman {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      code[vals[k]] = c;
      size[vals[k]] = len;
      c++;
      k++;
    }
    c <<= 1;
  }
  return { code, size };
}

class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private acc = 0;
  private bits = 0;

  private push(b: number): void {
    if (this.len === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.len++] = b;
  }

  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      if (++this.bits === 8) {
        this.push(this.acc);
        // A 0xFF byte in entropy-coded data is stuffed with 0x00 (T.81 F.1.2.3).
        if (this.acc === 0xff) this.push(0);
        this.acc = 0;
        this.bits = 0;
      }
    }
  }

  /** Pads the last byte with 1 bits. */
  bytes(): Uint8Array {
    if (this.bits > 0) {
      const pad = 8 - this.bits;
      this.write((1 << pad) - 1, pad);
    }
    return this.buf.subarray(0, this.len);
  }
}

const bitLength = (v: number): number => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));
const magnitude = (v: number, cat: number): number => (v < 0 ? v + (1 << cat) - 1 : v);

function forwardDct(block: Float64Array, tmp: Float64Array, out: Float64Array): void {
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x] * C[u * 8 + x];
      tmp[y * 8 + u] = s;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * C[v * 8 + y];
      out[v * 8 + u] = s;
    }
  }
}

/** A baseline JPEG of an 8-bit greyscale image (row-major, one byte per pixel). */
export function encodeGreyJpeg(grey: ArrayLike<number>, width: number, height: number, quality = 90): Uint8Array {
  const q = qualityTable(quality);
  const dc = huffman(DC_BITS, DC_VALS);
  const ac = huffman(AC_BITS, AC_VALS);
  const writer = new BitWriter();
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const coef = new Float64Array(64);
  const zz = new Int32Array(64);
  let previousDc = 0;

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = Math.min(by + y, height - 1) * width;
        for (let x = 0; x < 8; x++) block[y * 8 + x] = grey[row + Math.min(bx + x, width - 1)] - 128;
      }
      forwardDct(block, tmp, coef);
      for (let k = 0; k < 64; k++) {
        const n = ZIGZAG[k];
        const v = Math.round(coef[n] / q[n]);
        // Baseline AC categories stop at 10.
        zz[k] = k === 0 ? v : Math.max(-1023, Math.min(1023, v));
      }

      const diff = zz[0] - previousDc;
      previousDc = zz[0];
      const dcCat = bitLength(diff);
      writer.write(dc.code[dcCat], dc.size[dcCat]);
      if (dcCat > 0) writer.write(magnitude(diff, dcCat), dcCat);

      let run = 0;
      for (let k = 1; k < 64; k++) {
        const v = zz[k];
        if (v === 0) {
          run++;
          continue;
        }
        while (run > 15) {
          writer.write(ac.code[0xf0], ac.size[0xf0]);
          run -= 16;
        }
        const cat = bitLength(v);
        const symbol = (run << 4) | cat;
        writer.write(ac.code[symbol], ac.size[symbol]);
        writer.write(magnitude(v, cat), cat);
        run = 0;
      }
      if (run > 0) writer.write(ac.code[0x00], ac.size[0x00]);
    }
  }

  const dqt = new Uint8Array(65);
  for (let k = 0; k < 64; k++) dqt[1 + k] = q[ZIGZAG[k]];
  return concat([
    Uint8Array.of(0xff, 0xd8),
    segment(0xe0, Uint8Array.of(0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
    segment(0xdb, dqt),
    segment(0xc0, Uint8Array.of(8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0)),
    segment(0xc4, Uint8Array.from([0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS])),
    segment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
    writer.bytes(),
    Uint8Array.of(0xff, 0xd9),
  ]);
}
