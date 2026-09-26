import { useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

/**
 * Minimal observable store. React components read slices through `useStore` with a
 * selector, so they only re-render when the selected value changes. The engine reads
 * and writes synchronously through `get`/`set` without touching React.
 */
export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  readonly get = (): T => this.state;

  set(update: Partial<T> | ((state: T) => Partial<T>)): void {
    const patch = typeof update === 'function' ? update(this.state) : update;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Subscribes to a derived slice of a store. `isEqual` lets selectors that build new
 * objects/arrays (e.g. with shallowEqual) avoid re-rendering when contents are unchanged.
 */
export function useStore<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const cache = useRef<{ value: S } | null>(null);
  const getSnapshot = (): S => {
    const next = selector(store.get());
    const prev = cache.current;
    if (prev && isEqual(prev.value, next)) return prev.value;
    cache.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Tiny typed event emitter used for high-frequency engine events. */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) (handler as (payload: Events[K]) => void)(payload);
  }
}

let idCounter = 0;

/** Unique id with a readable prefix; random suffix keeps ids unique across sessions/projects. */
export function createId(prefix: string): string {
  idCounter = (idCounter + 1) % 0x7fffffff;
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, '0');
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}
