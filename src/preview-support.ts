// Whether the live HDR preview can run here: an HDR display (CSS
// dynamic-range: high), then a WebGPU adapter (WebGPU's extended tone mapping
// is the shipped way to show values above SDR white; WebGL's isn't shipped).

export type PreviewSupport = "checking" | "ok" | "no-hdr-display" | "no-webgpu";

export const SUPPORT_TEXT: Readonly<Record<Exclude<PreviewSupport, "ok">, string>> = {
  checking: "Checking the display…",
  "no-hdr-display": "This display isn't in HDR mode. Turn on HDR in the system's display settings.",
  "no-webgpu": "The HDR preview needs WebGPU, which isn't available here.",
};

/** Matches while the window is on a display in HDR mode. */
export const HDR_DISPLAY_QUERY = "(dynamic-range: high)";

export interface SupportEnv {
  hdrDisplay(): boolean;
  adapter(): Promise<boolean>;
}

export function liveSupportEnv(): SupportEnv {
  return {
    hdrDisplay: () => window.matchMedia(HDR_DISPLAY_QUERY).matches,
    adapter: async () => !!(await navigator.gpu?.requestAdapter()),
  };
}

export async function detectPreviewSupport(env: SupportEnv = liveSupportEnv()): Promise<PreviewSupport> {
  if (!env.hdrDisplay()) return "no-hdr-display";
  try {
    return (await env.adapter()) ? "ok" : "no-webgpu";
  } catch {
    return "no-webgpu";
  }
}
