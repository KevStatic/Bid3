"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared one-second clock. Returns null during prerender and hydration,
 * so no time-dependent text is baked into static HTML.
 */
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1_000);
    queueMicrotask(() => listeners.forEach((l) => l()));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}
