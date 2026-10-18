import { mergeConfig } from "vite";
import base from "./vite.config.ts";

// The HDR AVIF worker, dist/avif-worker.js: a second build, since a worker is
// started from a URL of its own and can't share a chunk with the main bundle.
// It runs after the main build, into the same folder.
export default mergeConfig(base, {
  build: {
    lib: { entry: "src/avif-worker.ts", fileName: "avif-worker" },
    emptyOutDir: false,
  },
});
