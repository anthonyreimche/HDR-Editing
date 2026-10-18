// Where an AV1 sequence header keeps its colour description. An AVIF file
// states its colour twice: in the container (colr/nclx) and in the AV1
// bitstream (sequence_header_obu › color_config). Decoders built on libavif
// take the container's, but one that trusts the bitstream would read whatever
// the encoder wrote there. jSquash writes primaries 2, transfer 2 (unspecified)
// and has no option to change them, so the 16 bits are rewritten in place:
// no length changes, and OBUs carry no checksum.
//
// Written against the AV1 specification: §5.3 (OBU header), §5.5 (sequence
// header up to color_config). Anything that doesn't parse as expected is left
// alone and reported, so a file never ends up half-rewritten.

export interface ColourDescription {
  primaries: number;
  transfer: number;
  matrix: number;
}

interface Located extends ColourDescription {
  /** Index, in bits from the start of the array, of colour_primaries. */
  bit: number;
}

const OBU_SEQUENCE_HEADER = 1;

/** The data ended inside a header. */
class Truncated extends Error {}

class Bits {
  private at: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.at = start * 8;
  }

  get position(): number {
    return this.at;
  }

  read(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      if (this.at >= this.end * 8) throw new Truncated();
      value = value * 2 + ((this.bytes[this.at >> 3] >> (7 - (this.at & 7))) & 1);
      this.at++;
    }
    return value;
  }

  /** The spec's uvlc(): a run of zeros, a one, then that many bits. */
  uvlc(): number {
    let zeros = 0;
    while (this.read(1) === 0) zeros++;
    return zeros >= 32 ? 0xffffffff : this.read(zeros) + 2 ** zeros - 1;
  }
}

/** The colour description in a sequence_header_obu payload, or null when it states none. */
function sequenceHeaderColour(bytes: Uint8Array, start: number, end: number): Located | null {
  const b = new Bits(bytes, start, end);
  const profile = b.read(3);
  b.read(1); // still_picture
  const reduced = b.read(1) === 1;
  if (reduced) {
    b.read(5); // seq_level_idx[0]
  } else {
    let decoderModel = false;
    let delayLength = 0;
    if (b.read(1) === 1) {
      // timing_info: num_units_in_display_tick, time_scale, equal_picture_interval
      b.read(32);
      b.read(32);
      if (b.read(1) === 1) b.uvlc(); // num_ticks_per_picture_minus_1
      decoderModel = b.read(1) === 1;
      if (decoderModel) {
        delayLength = b.read(5) + 1; // buffer_delay_length_minus_1
        b.read(32); // num_units_in_decoding_tick
        b.read(5); // buffer_removal_time_length_minus_1
        b.read(5); // frame_presentation_time_length_minus_1
      }
    }
    const displayDelay = b.read(1) === 1; // initial_display_delay_present_flag
    const points = b.read(5) + 1;
    for (let i = 0; i < points; i++) {
      b.read(12); // operating_point_idc
      if (b.read(5) > 7) b.read(1); // seq_level_idx, then seq_tier
      if (decoderModel && b.read(1) === 1) {
        // operating_parameters_info: decoder_buffer_delay, encoder_buffer_delay, low_delay_mode_flag
        b.read(delayLength);
        b.read(delayLength);
        b.read(1);
      }
      if (displayDelay && b.read(1) === 1) b.read(4); // initial_display_delay_minus_1
    }
  }
  const widthBits = b.read(4) + 1;
  const heightBits = b.read(4) + 1;
  b.read(widthBits); // max_frame_width_minus_1
  b.read(heightBits); // max_frame_height_minus_1
  if (!reduced && b.read(1) === 1) {
    b.read(4); // delta_frame_id_length_minus_2
    b.read(3); // additional_frame_id_length_minus_1
  }
  b.read(3); // use_128x128_superblock, enable_filter_intra, enable_intra_edge_filter
  if (!reduced) {
    b.read(4); // enable_interintra_compound, masked_compound, warped_motion, dual_filter
    const orderHint = b.read(1) === 1;
    if (orderHint) b.read(2); // enable_jnt_comp, enable_ref_frame_mvs
    // seq_choose_screen_content_tools, else the forced value; either way
    // above zero the integer-mv choice follows.
    const screenContent = b.read(1) === 1 || b.read(1) === 1;
    if (screenContent && b.read(1) === 0) b.read(1); // seq_choose_integer_mv, else seq_force_integer_mv
    if (orderHint) b.read(3); // order_hint_bits_minus_1
  }
  b.read(3); // enable_superres, enable_cdef, enable_restoration
  // color_config
  if (profile > 2) return null;
  const highBitdepth = b.read(1) === 1;
  if (profile === 2 && highBitdepth) b.read(1); // twelve_bit
  if (profile !== 1) b.read(1); // mono_chrome
  if (b.read(1) === 0) return null; // color_description_present_flag
  const bit = b.position;
  return { bit, primaries: b.read(8), transfer: b.read(8), matrix: b.read(8) };
}

/** leb128 of up to 8 bytes (§4.10.5). */
function leb128(bytes: Uint8Array, at: number, end: number): { value: number; length: number } | null {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    if (at + i >= end) return null;
    const byte = bytes[at + i];
    value += (byte & 0x7f) * 2 ** (7 * i);
    if ((byte & 0x80) === 0) return { value, length: i + 1 };
  }
  return null;
}

/** Walks the OBUs in [start, end) to the sequence header. */
function locate(bytes: Uint8Array, start: number, end: number): Located | null {
  try {
    let at = start;
    while (at < end) {
      const header = bytes[at];
      if (header & 0x80) return null; // obu_forbidden_bit
      const type = (header >> 3) & 15;
      let payload = at + 1 + ((header & 4) !== 0 ? 1 : 0); // obu_extension_flag
      let size = end - payload; // without a size field the OBU fills the rest
      if ((header & 2) !== 0) {
        const coded = leb128(bytes, payload, end);
        if (!coded) return null;
        size = coded.value;
        payload += coded.length;
      }
      if (size < 0 || payload + size > end) return null;
      if (type === OBU_SEQUENCE_HEADER) return sequenceHeaderColour(bytes, payload, payload + size);
      at = payload + size;
    }
    return null;
  } catch (e) {
    if (e instanceof Truncated) return null;
    throw e;
  }
}

function setBits(bytes: Uint8Array, bit: number, width: number, value: number): void {
  for (let i = 0; i < width; i++) {
    const at = bit + i;
    const mask = 0x80 >> (at & 7);
    if (Math.floor(value / 2 ** (width - 1 - i)) % 2 === 1) bytes[at >> 3] |= mask;
    else bytes[at >> 3] &= ~mask;
  }
}

const isByte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 255;
const isSrgb = (primaries: number, transfer: number) => primaries === 1 && transfer === 13;

/** The sequence header's colour description in the OBUs of [start, end), or null. */
export function readColourDescription(bytes: Uint8Array, start: number, end: number): ColourDescription | null {
  const found = locate(bytes, start, end);
  return found && { primaries: found.primaries, transfer: found.transfer, matrix: found.matrix };
}

/** Rewrites colour_primaries and transfer_characteristics in place, leaving
 *  matrix_coefficients and the rest alone; false (bytes untouched) when the
 *  header can't be read or has no colour description. */
export function patchColourDescription(bytes: Uint8Array, start: number, end: number, primaries: number, transfer: number): boolean {
  if (!isByte(primaries) || !isByte(transfer)) return false;
  const found = locate(bytes, start, end);
  if (!found) return false;
  // With sRGB primaries and transfer and the identity matrix, color_config
  // omits the colour range bit that follows; moving into or out of that
  // triple would shift how the rest of the header reads.
  if (found.matrix === 0 && (isSrgb(found.primaries, found.transfer) || isSrgb(primaries, transfer))) return false;
  setBits(bytes, found.bit, 8, primaries);
  setBits(bytes, found.bit + 8, 8, transfer);
  return true;
}
