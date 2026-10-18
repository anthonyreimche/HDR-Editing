import { afterEach, describe, expect, it, vi } from "vitest";
import { liveAvifLoaders } from "../src/avif";

afterEach(() => vi.unstubAllGlobals());

// The installed build is the one place import.meta.url is undefined, so the
// loaders must reach the files through the plugin's served path instead.
describe("liveAvifLoaders", () => {
  it("fetches the wasm from the plugin's dist folder, versioned", async () => {
    vi.stubGlobal("location", { origin: "app://safelight" });
    const fetchMock = vi.fn(async (_url: string) => new Response(Uint8Array.of(0, 97, 115, 109)));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await liveAvifLoaders().wasm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^app:\/\/safelight\/__plugins__\/hdr-editing\/dist\/avif_enc\.wasm\?v=\d+\.\d+\.\d+$/);
    expect(new Uint8Array(bytes as ArrayBuffer)).toEqual(Uint8Array.of(0, 97, 115, 109));
  });

  it("says which status stopped the wasm, so a missing file isn't a bare compile error", async () => {
    vi.stubGlobal("location", { origin: "app://safelight" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(liveAvifLoaders().wasm()).rejects.toThrow("AVIF encoder unavailable (404)");
  });
});
