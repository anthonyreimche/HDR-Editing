// Sibling files of the installed bundle. import.meta.url is undefined in
// app://-served plugin modules, so URLs are built the way core's loader
// builds them; the manifest version (inlined at build time) busts caches.

import { EXT_ID } from "./params";

declare const __EXT_VERSION__: string;

export function assetUrl(rel: string): string {
  const v = typeof __EXT_VERSION__ === "string" ? __EXT_VERSION__ : "";
  return `${location.origin}/__plugins__/${EXT_ID}/${rel}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
}
