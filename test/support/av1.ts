// Builders for AV1 OBUs and sequence headers, written from the syntax in the
// AV1 specification (§5.3 OBU header, §5.5 sequence header) in the writing
// direction, so the parser is checked against a second reading of it rather
// than against its own assumptions.

export class BitWriter {
  private bits: number[] = [];

  put(value: number, width: number): this {
    for (let i = width - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
    return this;
  }

  /** The spec's uvlc(): leadingZeros zeros, a one, then leadingZeros bits. */
  uvlc(value: number): this {
    const x = value + 1;
    const zeros = Math.floor(Math.log2(x));
    return this.put(0, zeros).put(1, 1).put(x - 2 ** zeros, zeros);
  }

  get length(): number {
    return this.bits.length;
  }

  /** trailing_bits(): a one, then zeros up to the byte boundary. */
  bytes(): Uint8Array {
    const bits = [...this.bits, 1];
    while (bits.length % 8) bits.push(0);
    return Uint8Array.from({ length: bits.length / 8 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((v, b) => v * 2 + b, 0));
  }
}

export interface OperatingPoint {
  idc?: number;
  /** seq_level_idx; above 7 a tier bit follows. */
  level?: number;
  tier?: boolean;
  decoderModelPresent?: boolean;
  displayDelay?: boolean;
}

export interface SeqSpec {
  profile?: 0 | 1 | 2;
  reduced?: boolean;
  /** timing_info_present_flag, with the optional decoder model after it. */
  timing?: { equalPictureInterval: boolean; decoderModel: boolean };
  /** initial_display_delay_present_flag. */
  displayDelay?: boolean;
  operatingPoints?: OperatingPoint[];
  frameIds?: boolean;
  orderHint?: boolean;
  screenContent?: "choose" | 0 | 1;
  integerMv?: "choose" | 0 | 1;
  highBitdepth?: boolean;
  twelveBit?: boolean;
  mono?: boolean;
  /** [colour_primaries, transfer_characteristics, matrix_coefficients]; null leaves the description out. */
  colour?: [number, number, number] | null;
}

const BUFFER_DELAY_LENGTH = 7;

/** The sequence_header_obu payload, and the payload bit where colour_primaries starts. */
export function sequenceHeader(s: SeqSpec = {}): { payload: Uint8Array; colourBit: number } {
  const w = new BitWriter();
  const profile = s.profile ?? 0;
  w.put(profile, 3).put(1, 1).put(s.reduced ? 1 : 0, 1);
  if (s.reduced) {
    w.put(4, 5);
  } else {
    const model = s.timing?.decoderModel ?? false;
    w.put(s.timing ? 1 : 0, 1);
    if (s.timing) {
      w.put(1001, 32).put(30000, 32).put(s.timing.equalPictureInterval ? 1 : 0, 1);
      if (s.timing.equalPictureInterval) w.uvlc(4);
      w.put(model ? 1 : 0, 1);
      if (model) w.put(BUFFER_DELAY_LENGTH - 1, 5).put(1000, 32).put(9, 5).put(9, 5);
    }
    const points = s.operatingPoints ?? [{}];
    w.put(s.displayDelay ? 1 : 0, 1).put(points.length - 1, 5);
    for (const p of points) {
      const level = p.level ?? 4;
      w.put(p.idc ?? 0, 12).put(level, 5);
      if (level > 7) w.put(p.tier ? 1 : 0, 1);
      if (model) {
        w.put(p.decoderModelPresent ? 1 : 0, 1);
        if (p.decoderModelPresent) w.put(0x55, BUFFER_DELAY_LENGTH).put(0x2a, BUFFER_DELAY_LENGTH).put(1, 1);
      }
      if (s.displayDelay) {
        w.put(p.displayDelay ? 1 : 0, 1);
        if (p.displayDelay) w.put(3, 4);
      }
    }
  }
  w.put(11, 4).put(11, 4).put(3999, 12).put(2999, 12);
  if (!s.reduced) {
    w.put(s.frameIds ? 1 : 0, 1);
    if (s.frameIds) w.put(5, 4).put(2, 3);
  }
  w.put(0, 1).put(1, 1).put(1, 1);
  if (!s.reduced) {
    w.put(0b1010, 4).put(s.orderHint ? 1 : 0, 1);
    if (s.orderHint) w.put(1, 1).put(0, 1);
    const content = s.screenContent ?? "choose";
    if (content === "choose") w.put(1, 1);
    else w.put(0, 1).put(content, 1);
    if (content !== 0) {
      const mv = s.integerMv ?? "choose";
      if (mv === "choose") w.put(1, 1);
      else w.put(0, 1).put(mv, 1);
    }
    if (s.orderHint) w.put(6, 3);
  }
  w.put(0, 1).put(1, 1).put(1, 1);
  w.put(s.highBitdepth ? 1 : 0, 1);
  if (profile === 2 && s.highBitdepth) w.put(s.twelveBit ? 1 : 0, 1);
  if (profile !== 1) w.put(s.mono ? 1 : 0, 1);
  const colour = s.colour === undefined ? [2, 3, 6] : s.colour;
  w.put(colour ? 1 : 0, 1);
  const colourBit = w.length;
  if (colour) w.put(colour[0], 8).put(colour[1], 8).put(colour[2], 8);
  // color_range, chroma_sample_position, separate_uv_delta_q, film_grain_params_present
  w.put(1, 1).put(0, 2).put(0, 1).put(0, 1);
  return { payload: w.bytes(), colourBit };
}

export interface ObuOptions {
  extension?: boolean;
  /** obu_has_size_field; without it the OBU runs to the end of the data. */
  sizeField?: boolean;
  /** Bytes the leb128 size is spread over (legal with padding). */
  sizeBytes?: number;
}

/** One OBU: header byte, optional extension byte, optional leb128 size, payload. */
export function obu(type: number, payload: Uint8Array, o: ObuOptions = {}): Uint8Array {
  const sizeField = o.sizeField ?? true;
  const head = [(type << 3) | (o.extension ? 4 : 0) | (sizeField ? 2 : 0)];
  if (o.extension) head.push(0x20);
  if (sizeField) {
    let needed = 1;
    while (payload.length >= 128 ** needed) needed++;
    const count = Math.max(o.sizeBytes ?? 1, needed);
    let rest = payload.length;
    for (let i = 0; i < count; i++) {
      const low = rest % 128;
      rest = Math.floor(rest / 128);
      head.push(i < count - 1 ? low | 0x80 : low);
    }
  }
  return Uint8Array.of(...head, ...payload);
}

export const TEMPORAL_DELIMITER = obu(2, new Uint8Array(0));
