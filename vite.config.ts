import { defineConfig } from "vite";

export default defineConfig({
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
