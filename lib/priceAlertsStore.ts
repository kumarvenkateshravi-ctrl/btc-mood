'use client';

// Reactive, localStorage-backed store for price alerts so the context menu,
// the on-chart lines, the management pills, and the firing effect all stay in
// sync. Mirrors the lightweight singleton-store pattern used elsewhere.

import { useSyncExternalStore } from 'react';
import {
  PRICE_ALERTS_KEY,
  isPriceAlert,
  newPriceAlertId,
  type PriceAlert,
  type PriceAlertSide,
} from './priceAlerts';

let cache: PriceAlert[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: PriceAlert[] = [];

function load(): PriceAlert[] {
  if (cache) return cache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(PRICE_ALERTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isPriceAlert) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: PriceAlert[]) {
  cache = next;
  try {
    window.localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / disabled storage
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => cache ?? load();
const getServerSnapshot = () => EMPTY;

export function addPriceAlert(input: { symbol: string; price: number; side: PriceAlertSide }): PriceAlert {
  const alert: PriceAlert = {
    id: newPriceAlertId(),
    symbol: input.symbol,
    price: input.price,
    side: input.side,
    enabled: true,
    createdAt: Date.now(),
    lastFiredAt: null,
  };
  save([alert, ...load()]);
  return alert;
}

export function removePriceAlert(id: string) {
  save(load().filter((a) => a.id !== id));
}

export function togglePriceAlert(id: string) {
  save(load().map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
}

export function markPriceAlertsFired(ids: string[], ts = Date.now()) {
  if (ids.length === 0) return;
  const set = new Set(ids);
  save(load().map((a) => (set.has(a.id) ? { ...a, lastFiredAt: ts, enabled: false } : a)));
}

/** Non-reactive read for use inside effects. */
export function getPriceAlerts(): PriceAlert[] {
  return load();
}

export function usePriceAlerts(): PriceAlert[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
