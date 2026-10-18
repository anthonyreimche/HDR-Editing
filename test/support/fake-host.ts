// A minimal stand-in for the host: a zustand-shaped store and a hook runtime
// just big enough to run a function component by hand (render, run the effects
// whose dependencies changed, unmount). It lets the overlay's behaviour be
// tested without a DOM, because the extension never bundles its own React.

import type { ReactElement } from "react";
import type { SafelightAPI, StateCreator, StoreApi } from "../../src/safelight";

type Listener<T> = (state: T, prev: T) => void;

export function createStore<T>(init: StateCreator<T>): StoreApi<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();
  const setState = (partial: Partial<T> | ((s: T) => Partial<T>)): void => {
    const prev = state;
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    for (const listener of [...listeners]) listener(state, prev);
  };
  state = init(setState, () => state);
  const hook = <U>(selector?: (s: T) => U): T | U => (selector ? selector(state) : state);
  return Object.assign(hook, {
    getState: () => state,
    setState,
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  }) as unknown as StoreApi<T>;
}

type Cleanup = void | (() => void);
type EffectFn = () => Cleanup;

interface RefSlot {
  kind: "ref";
  ref: { current: unknown };
}
interface StateSlot {
  kind: "state";
  value: unknown;
}
interface EffectSlot {
  kind: "effect";
  deps: readonly unknown[] | undefined;
  cleanup: Cleanup;
}
interface MemoSlot {
  kind: "memo";
  deps: readonly unknown[] | undefined;
  value: unknown;
}
type Slot = RefSlot | StateSlot | EffectSlot | MemoSlot;

class Instance {
  slots: Slot[] = [];
  cursor = 0;
  queued: { slot: EffectSlot; fn: EffectFn }[] = [];
  /** A state setter ran since the last render. */
  dirty = false;
}

let active: Instance | null = null;

function slotAt<S extends Slot>(make: () => S): { slot: S; fresh: boolean; inst: Instance } {
  if (!active) throw new Error("a hook was called outside a render");
  const inst = active;
  const index = inst.cursor++;
  const existing = inst.slots[index];
  if (existing) return { slot: existing as S, fresh: false, inst };
  const slot = make();
  inst.slots[index] = slot;
  return { slot, fresh: true, inst };
}

const changed = (prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean =>
  !prev || !next || prev.length !== next.length || next.some((d, i) => !Object.is(d, prev[i]));

export interface FakeElement {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown[];
}

export const fakeReact = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): FakeElement => ({
    type,
    props,
    children,
  }),
  useRef: (initial: unknown) => slotAt<RefSlot>(() => ({ kind: "ref", ref: { current: initial } })).slot.ref,
  useState: (initial: unknown) => {
    const { slot, inst } = slotAt<StateSlot>(() => ({ kind: "state", value: initial }));
    const set = (next: unknown): void => {
      slot.value = typeof next === "function" ? (next as (v: unknown) => unknown)(slot.value) : next;
      inst.dirty = true;
    };
    return [slot.value, set];
  },
  useMemo: (make: () => unknown, deps: readonly unknown[]) => {
    const { slot } = slotAt<MemoSlot>(() => ({ kind: "memo", deps: undefined, value: undefined }));
    if (changed(slot.deps, deps)) {
      slot.deps = deps;
      slot.value = make();
    }
    return slot.value;
  },
  useEffect: (fn: EffectFn, deps?: readonly unknown[]): void => {
    const { slot, fresh, inst } = slotAt<EffectSlot>(() => ({ kind: "effect", deps: undefined, cleanup: undefined }));
    if (fresh || changed(slot.deps, deps)) {
      slot.deps = deps;
      inst.queued.push({ slot, fn });
    }
  },
} as unknown as SafelightAPI["react"];

export interface Mounted {
  /** One render, then the effects whose dependencies changed (cleanups first). */
  render(): FakeElement | null;
  unmount(): void;
  readonly dirty: boolean;
}

export function mount(component: () => ReactElement | null): Mounted {
  const inst = new Instance();
  return {
    render() {
      active = inst;
      inst.cursor = 0;
      inst.queued = [];
      inst.dirty = false;
      let out: ReactElement | null;
      try {
        out = component();
      } finally {
        active = null;
      }
      for (const { slot } of inst.queued) if (typeof slot.cleanup === "function") slot.cleanup();
      for (const { slot, fn } of inst.queued) slot.cleanup = fn();
      return out as unknown as FakeElement | null;
    },
    unmount() {
      for (const slot of inst.slots) {
        if (slot.kind === "effect" && typeof slot.cleanup === "function") slot.cleanup();
      }
    },
    get dirty() {
      return inst.dirty;
    },
  };
}
