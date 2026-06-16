// Tiny singleton store for chart hover state, consumed by both
// `components/Chart.tsx` (publisher) and `components/OHLCLegend.tsx`
// (subscriber) without prop-drilling. `useSyncExternalStore` keeps
// the API React-idiomatic; no external state library needed.

import { useSyncExternalStore } from 'react';
import type { Candle } from './types';

export interface HoverPayload {
  /** Source candle (pre-Heikin-Ashi) — used for volume, which is
   *  invariant under HA transformation. */
  src: Candle;
  /** Base candle (post-Heikin-Ashi when HA mode is on, else identical
   *  to src) — used for O/H/L/C. */
  base: Candle;
  /** Previous base candle, used for calculating price change and %. */
  prevBase: Candle | null;
  emaFast: number | null;
  emaSlow: number | null;
}

interface State {
  hover: HoverPayload | null;
  /** Last non-null hover, kept so the legend can show "last bar" values
   *  when the cursor leaves the chart area. */
  last: HoverPayload | null;
}

const listeners = new Set<() => void>();
let state: State = { hover: null, last: null };

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): State {
  return state;
}

export function setHover(h: HoverPayload | null): void {
  if (h === null) {
    if (state.hover === null) return;
    state = { hover: null, last: state.last ?? state.hover };
  } else {
    state = { hover: h, last: h };
  }
  emit();
}

export function getHover(): HoverPayload | null {
  return state.hover;
}

export function getLast(): HoverPayload | null {
  return state.last;
}

/**
 * React hook that returns the current hover state. Uses
 * `useSyncExternalStore` so consumers re-render only when the
 * snapshot actually changes.
 */
export function useHover(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
