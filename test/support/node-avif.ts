// jSquash's AVIF encoder loaded from node_modules, for the tests that encode
// for real in Node.

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { AvifFactory, AvifLoaders } from "../../src/avif";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "@jsquash", "avif", "codec", "enc");

export const nodeAvifLoaders: AvifLoaders = {
  factory: async () => {
    const spec = pathToFileURL(join(dir, "avif_enc.js")).href;
    return ((await import(/* @vite-ignore */ spec)) as { default: AvifFactory }).default;
  },
  wasm: () => readFile(join(dir, "avif_enc.wasm")),
};
