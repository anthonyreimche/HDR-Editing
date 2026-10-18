// Copies jSquash's single-thread AVIF encoder (glue + wasm) next to the
// bundle and the AVIF worker (vite.worker.config.ts), which loads them at
// runtime from /__plugins__/hdr-editing/dist/, not through a bundle: the wasm
// is 3.5 MB and only an HDR AVIF export needs it. The single-thread build is used on purpose: the app is cross-origin
// isolated, so jSquash's own init() would pick its threaded build and spawn
// workers.
import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@jsquash", "avif", "codec", "enc");
const to = join(root, "dist");
mkdirSync(to, { recursive: true });
for (const file of ["avif_enc.js", "avif_enc.wasm"]) copyFileSync(join(from, file), join(to, file));
