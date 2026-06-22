'use client';

import { useEffect, useRef } from 'react';
import type { Timeframe, Signal } from '../types';
import { TIMEFRAMES } from '../types';
import type { TFSnapshot } from '../signals';
import { loadRules, rulesToFire, saveRules, type AlertSide } from '../alerts';
import { priceAlertsToFire } from '../priceAlerts';
import { getPriceAlerts, markPriceAlertsFired } from '../priceAlertsStore';

function notify(body: string) {
  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      new Notification('BTC Market Mood', { body });
    } catch {
      // ignore
    }
  }
}

/**
 * Fires two kinds of browser notifications:
 *   1. Signal alerts — when a TF's EMA/RSI verdict flips to buy/sell.
 *   2. Price alerts — when the live mid crosses a user-set price level.
 *
 * Both are one-shot per crossing/flip; the refs prevent duplicate
 * notifications within the same session.
 */
export function useAlerts(
  symbol: string,
  snapshots: Record<Timeframe, TFSnapshot | null>,
  bid: number | null,
  ask: number | null,
  currentPrice: number | null,
): void {
  // ---- Signal-alert firing ----
  const lastFiredSideRef = useRef<Record<string, AlertSide | null>>({});
  useEffect(() => {
    const rules = loadRules();
    if (rules.length === 0) return;
    const sigMap = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, snapshots[tf]?.signal ?? null]),
    ) as Record<Timeframe, Signal | null>;
    const toFire = rulesToFire(rules, sigMap, lastFiredSideRef.current);
    if (toFire.length === 0) return;
    for (const r of toFire) {
      const msg = `${symbol} · ${r.tf} flipped to ${r.side.toUpperCase()}`;
      console.info('[alert]', msg);
      notify(msg);
    }
    const updated = rules.map((r) =>
      toFire.find((f) => f.id === r.id) ? { ...r, lastFiredAt: Date.now() } : r,
    );
    saveRules(updated);
    const next: Record<string, AlertSide | null> = { ...lastFiredSideRef.current };
    for (const r of toFire) next[r.id] = r.side;
    lastFiredSideRef.current = next;
  }, [snapshots, symbol]);

  // ---- Price-alert firing ----
  const prevPriceRef = useRef<number | null>(null);
  useEffect(() => {
    const last = bid != null && ask != null ? (bid + ask) / 2 : currentPrice;
    if (last == null || !Number.isFinite(last)) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = last;
    if (prev == null) return;
    const fired = priceAlertsToFire(getPriceAlerts(), symbol, prev, last);
    if (fired.length === 0) return;
    for (const a of fired) {
      const msg = `${symbol} crossed ${a.side} ${a.price}`;
      console.info('[price-alert]', msg);
      notify(msg);
    }
    markPriceAlertsFired(fired.map((a) => a.id));
  }, [bid, ask, currentPrice, symbol]);
}
