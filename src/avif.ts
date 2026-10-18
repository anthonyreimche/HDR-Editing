// The AVIF encoder, run in the AVIF worker (avif-job.ts): jSquash 2.1.1's
// single-thread libavif + aom build, compiled once, on the first HDR AVIF
// export, and instantiated for each encode. The glue and wasm sit next to the
// bundle (scripts/copy-assets.mjs) and load through asset URLs;
// instantiateWasm hands the glue a module compiled here, so it never has to
// locate the wasm itself. jSquash's own init() isn't used: the app is
// cross-origin isolated, so it would choose the threaded build.

import { assetUrl } from "./asset-url";
import { patchNclx, patchSequenceHeaderCicp } from "./avif-box";

export interface AvifOptions {
  quality: number;
  qualityAlpha: number;
  denoiseLevel: number;
  tileColsLog2: number;
  tileRowsLog2: number;
  speed: number;
  subsample: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  tune: number;
  enableSharpYUV: boolean;
  bitDepth: number;
}

export interface AvifModule {
  encode(data: Uint8Array, width: number, height: number, options: AvifOptions): Uint8Array | null;
}

export type AvifFactory = (overrides: {
  noInitialRun: boolean;
  locateFile(path: string): string;
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): object;
}) => Promise<AvifModule>;

export interface AvifLoaders {
  factory(): Promise<AvifFactory>;
  wasm(): Promise<BufferSource>;
}

interface CompiledEncoder {
  factory: AvifFactory;
  compiled: WebAssembly.Module;
}

// Only the glue and the compiled module are kept. An instance's linear memory
// grows to fit the largest photo it encoded and never shrinks, and an abort
// (out of memory, say) leaves the instance unusable, so each encode makes its
// own and lets it go.
let loading: Promise<CompiledEncoder> | null = null;

function compileAvifEncoder(loaders: AvifLoaders): Promise<CompiledEncoder> {
  if (!loading) {
    const started = (async () => {
      const [factory, bytes] = await Promise.all([loaders.factory(), loaders.wasm()]);
      return { factory, compiled: await WebAssembly.compile(bytes) };
    })();
    loading = started;
    // A failed load (offline asset, bad wasm) may be retried by the next export.
    started.catch(() => {
      if (loading === started) loading = null;
    });
  }
  return loading;
}

function instantiate({ factory, compiled }: CompiledEncoder): Promise<AvifModule> {
  // The glue's ready promise never settles when instantiation fails, so the
  // failure has to reject on its own; otherwise the encode would hang.
  let instantiationFailed: (reason: unknown) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    instantiationFailed = reject;
  });
  const ready = factory({
    noInitialRun: true,
    locateFile: (path) => path,
    instantiateWasm: (imports, done) => {
      void WebAssembly.instantiate(compiled, imports).then(done).catch(instantiationFailed);
      return {};
    },
  });
  return Promise.race([ready, failure]);
}

/** A new encoder instance, from the module compiled on the first call. */
export async function loadAvifEncoder(loaders: AvifLoaders): Promise<AvifModule> {
  const pending = compileAvifEncoder(loaders);
  const encoder = await pending;
  try {
    return await instantiate(encoder);
  } catch (err) {
    // A module that won't link fails every instance alike: compile afresh next time.
    if (loading === pending) loading = null;
    throw err;
  }
}

export function resetAvifEncoder(): void {
  loading = null;
}

/** 10-bit RGBA (alpha 1023) → AVIF bytes, 4:2:0, as jSquash writes them: the
 *  colour description (colr/nclx and the AV1 sequence header) says primaries 2,
 *  transfer 2, which is not what PQ pixels are. encodeAvif10 corrects that;
 *  this is for what compares against the file before it. */
export async function encodeAvif10Raw(
  rgba: Uint16Array,
  width: number,
  height: number,
  quality: number,
  loaders: AvifLoaders,
): Promise<Uint8Array> {
  if (rgba.byteOffset !== 0 || rgba.byteLength !== rgba.buffer.byteLength) {
    throw new Error("[hdr-editing] AVIF input must own its whole buffer");
  }
  const encoder = await loadAvifEncoder(loaders);
  const out = encoder.encode(new Uint8Array(rgba.buffer), width, height, {
    quality,
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileColsLog2: 0,
    tileRowsLog2: 0,
    speed: 6,
    subsample: 1,
    chromaDeltaQ: false,
    sharpness: 0,
    tune: 0,
    enableSharpYUV: false,
    bitDepth: 10,
  });
  if (!out) throw new Error("[hdr-editing] AVIF encoding failed");
  return new Uint8Array(out);
}

/** The same file, marked as the BT.2020 PQ it holds: in the colour box, which
 *  libavif-based decoders (Chromium among them) take, and in the AV1 sequence
 *  header, so a decoder that reads the bitstream agrees. Both patches keep
 *  every size, and callers that patch the box themselves find it done. */
export async function encodeAvif10(
  rgba: Uint16Array,
  width: number,
  height: number,
  quality: number,
  loaders: AvifLoaders,
): Promise<Uint8Array> {
  const out = await encodeAvif10Raw(rgba, width, height, quality, loaders);
  if (!patchNclx(out)) throw new Error("[hdr-editing] the AVIF has no colour box to mark as PQ");
  // False only when the sequence header can't be read; the colour box governs then.
  patchSequenceHeaderCicp(out);
  return out;
}

export function liveAvifLoaders(): AvifLoaders {
  return {
    factory: () =>
      import(/* @vite-ignore */ assetUrl("dist/avif_enc.js")).then((m: { default: AvifFactory }) => m.default),
    wasm: () =>
      fetch(assetUrl("dist/avif_enc.wasm")).then((r) => {
        if (!r.ok) throw new Error(`[hdr-editing] AVIF encoder unavailable (${r.status})`);
        return r.arrayBuffer();
      }),
  };
}
