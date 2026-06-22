'use client';

// Shared "current mark" per symbol: the price + time the chart is currently
// showing. The chart writes it (live price normally, the replay bar's close
// during Bar Replay); the trading panel reads it so P&L, entries, and the
// "Current Price" readout track replay as well as live data.

import { useSyncExternalStore } from 'react';

export interface Mark {
  price: number;
  /** Unix seconds of the bar this mark belongs to. */
  time: number;
}

const marks: Record<string, Mark> = {};
const listeners = new Set<() => void>();

export function setMarkPrice(symbol: string, price: number, time: number) {
  const cur = marks[symbol];
  if (cur && cur.price === price && cur.time === time) return;
  marks[symbol] = { price, time };
  for (const l of listeners) l();
}

export function getMarkPrice(symbol: string): Mark | null {
  return marks[symbol] ?? null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useMarkPrice(symbol: string): Mark | null {
  return useSyncExternalStore(
    subscribe,
    () => marks[symbol] ?? null,
    () => null,
  );
}
