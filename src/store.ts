// Session state shared by the panel and the overlay: the latest frame pair
// (whose bitmaps the store owns and closes when replaced), the small readback
// the histogram uses, how many HDR panels are open, the two view toggles, and
// what the preview can do on this display, kept current by watchSupport.

import type { FrameSample } from "./frame";
import type { FramePair } from "./frames";
import { HDR_DISPLAY_QUERY, detectPreviewSupport, type PreviewSupport } from "./preview-support";
import { api } from "./runtime";
import type { StoreApi } from "./safelight";

export interface Session {
  pair: FramePair | null;
  samples: { sdr: FrameSample; gain: FrameSample } | null;
  panels: number;
  preview: boolean;
  visualize: boolean;
  support: PreviewSupport;
  setPair(pair: FramePair | null, samples: Session["samples"]): void;
  panelMounted(): () => void;
  setPreview(on: boolean): void;
  setVisualize(on: boolean): void;
  setSupport(support: PreviewSupport): void;
}

let session: StoreApi<Session> | null = null;

export function initStore(): void {
  // A second activate() replaces the store; the pair of the first would be
  // unreachable, and its bitmaps would never be closed.
  clearStore();
  session = api().stores.create<Session>((set, get) => ({
    pair: null,
    samples: null,
    panels: 0,
    preview: false,
    visualize: false,
    support: "checking",
    setPair: (pair, samples) => {
      const old = get().pair;
      if (old && old !== pair) {
        old.sdr.close();
        old.gain.close();
      }
      set({ pair, samples });
    },
    panelMounted: () => {
      set({ panels: get().panels + 1 });
      return () => set({ panels: Math.max(0, get().panels - 1) });
    },
    setPreview: (preview) => set({ preview }),
    setVisualize: (visualize) => set({ visualize }),
    setSupport: (support) => set({ support }),
  }));
}

export function store(): StoreApi<Session> {
  if (!session) throw new Error("[hdr-editing] store() called before activate()");
  return session;
}

/** Drops the pair (closing its bitmaps) on deactivate. */
export function clearStore(): void {
  session?.getState().setPair(null, null);
}

let unwatch: (() => void) | null = null;

/** Keeps `support` current from activate() on, whether or not a panel is
 *  open: the preview shows with the panel closed, and must stop when the
 *  window moves to an SDR display. The latest check wins; one still in flight
 *  when a newer one starts, or after unwatchSupport(), is dropped. */
export function watchSupport(): void {
  unwatchSupport();
  let latest = 0;
  const check = (): void => {
    const mine = ++latest;
    void detectPreviewSupport().then((support) => {
      if (mine === latest) session?.getState().setSupport(support);
    });
  };
  const query = window.matchMedia(HDR_DISPLAY_QUERY);
  query.addEventListener("change", check);
  unwatch = () => {
    latest++;
    query.removeEventListener("change", check);
  };
  check();
}

export function unwatchSupport(): void {
  unwatch?.();
  unwatch = null;
}
