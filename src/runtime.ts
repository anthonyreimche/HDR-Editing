// The scoped API captured at activate(), and createElement off the app's React
// (extensions must never bundle their own copy; a second React breaks hooks).

import type { Attributes, ComponentType, ReactElement, ReactNode } from "react";
import type { SafelightAPI } from "./safelight";

let current: SafelightAPI | null = null;

export function initRuntime(host: SafelightAPI): void {
  current = host;
}

export function api(): SafelightAPI {
  if (!current) throw new Error("[hdr-editing] api() called before activate()");
  return current;
}

export function h<P extends object>(
  type: string | ComponentType<P>,
  props?: (Attributes & P) | null,
  ...children: ReactNode[]
): ReactElement {
  return api().react.createElement(type, props, ...children);
}
