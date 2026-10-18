import { readFileSync } from "fs";
import { defineConfig } from "vite";

const manifest = JSON.parse(readFileSync(new URL("./safelight.json", import.meta.url), "utf-8")) as { version: string };

export default defineConfig({
  // Asset URLs carry the version so an update never serves a stale wasm.
  define: { __EXT_VERSION__: JSON.stringify(manifest.version) },
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    // Safelight injects its own React at runtime via api.react — never bundle one.
    rollupOptions: { external: ["react", "react-dom"], output: { inlineDynamicImports: true } },
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/gpu/**"],
    environment: "node",
  },
});
