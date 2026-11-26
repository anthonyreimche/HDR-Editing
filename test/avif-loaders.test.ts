import { afterEach, describe, expect, it, vi } from "vitest";
import { liveAvifLoaders } from "../src/avif";

afterEach(() => vi.unstubAllGlobals());

const FILES = {
  glue: "app://bundle/__plugins__/hdr-editing/dist/avif_enc.js?v=9.9.9",
  wasm: "app://bundle/__plugins__/hdr-editing/dist/avif_enc.wasm?v=9.9.9",
};

// The worker has no api, so the page hands it the encoder's asset URLs.
describe("liveAvifLoaders", () => {
  it("fetches the wasm from the URL it was handed", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(Uint8Array.of(0, 97, 115, 109)));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await liveAvifLoaders(FILES).wasm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FILES.wasm);
    expect(new Uint8Array(bytes as ArrayBuffer)).toEqual(Uint8Array.of(0, 97, 115, 109));
  });

  it("says which status stopped the wasm, so a missing file isn't a bare compile error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(liveAvifLoaders(FILES).wasm()).rejects.toThrow("AVIF encoder unavailable (404)");
  });
});
