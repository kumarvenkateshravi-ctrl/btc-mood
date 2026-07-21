'use client';

// MA-FVG signal card (Custom MTF, 5m). The indicator DECIDES independently; the
// SMC + 5m-MTF blocks only EXPLAIN. Context is read-only and can never change
// the signal. Runs the shared signal engine on 5m CLOSED bars (memoized on the
// 5m closed-bar signature — never on ticks).
// Spec: docs/superpowers/specs/2026-07-21-ma-fvg-signal-card-design.md

import { useMemo } from 'react';
import type { Candle, Timeframe } from '@/lib/types';
import type { Verdict } from '@/lib/mtf/types';
import type { RegimeType } from '@/lib/mtf/timeframe/timeframeTypes';
import type { FullMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import type { SmcSnapshot, SmcDirection, ZoneName } from '@/lib/smc/types';
import { computeMaFvgSignals, freshnessOf, type SignalFreshness } from '@/lib/indicators/maFvg/signals';

const SIGNAL_TF: Timeframe = '5m';

export interface MaFvgSignalView {
  /** The most recent 5m signal, always shown with its age + freshness. */
  latest: {
    side: 'buy' | 'sell';
    confidence: number;
    barTime: number;   // UNIX seconds of the signal bar
    barsAgo: number;
    freshness: SignalFreshness;
    price: number;
  } | null;
  /** Up to the last 3 signals, most-recent first (for a compact history row). */
  recent: Array<{ side: 'buy' | 'sell'; barTime: number; barsAgo: number }>;
  /** Explanatory context — display only, never gates the decision. */
  context: {
    mtf5m: { bias: Verdict; regime: RegimeType; confidence: number } | null;
    smc: { trend: Verdict; zone: ZoneName; lastEvent: { type: string; direction: SmcDirection } | null } | null;
  };
}

const biasWord = (b: number): Verdict => (b > 0 ? 'bullish' : b < 0 ? 'bearish' : 'neutral');

/** Pure builder (testable). Consumes the page's already-computed layers. */
export function buildMaFvgSignalView(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  full: FullMarketIntelligence,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
): MaFvgSignalView {
  const arr = candlesByTf[SIGNAL_TF];
  const events = arr && arr.length > 1 ? computeMaFvgSignals(arr) : [];
  const lastClosedIndex = arr ? arr.length - 2 : -1; // final bar is still forming

  const withAge = events.map((e) => ({
    side: e.side,
    confidence: e.confidence,
    barTime: arr![e.index].time,
    barsAgo: lastClosedIndex - e.index,
    price: arr![e.index].close,
  }));

  const last = withAge[withAge.length - 1] ?? null;
  const latest = last ? { ...last, freshness: freshnessOf(last.barsAgo) } : null;
  const recent = withAge.slice(-3).reverse().map((e) => ({ side: e.side, barTime: e.barTime, barsAgo: e.barsAgo }));

  const e5 = full.layers.hierarchy.perTimeframe[SIGNAL_TF];
  const mtf5m = e5 ? { bias: e5.bias, regime: e5.regime, confidence: e5.confidence } : null;

  const smc5 = smcByTf[SIGNAL_TF];
  const lastSmcEvent = smc5?.events[smc5.events.length - 1];
  const smc = smc5
    ? {
        trend: biasWord(smc5.state.swingTrend),
        zone: smc5.state.zone,
        lastEvent: lastSmcEvent ? { type: lastSmcEvent.type, direction: lastSmcEvent.direction } : null,
      }
    : null;

  return { latest, recent, context: { mtf5m, smc } };
}

export function useMaFvgSignal(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  full: FullMarketIntelligence,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
): MaFvgSignalView {
  const arr = candlesByTf[SIGNAL_TF];
  const sig = arr && arr.length > 1 ? `${arr[arr.length - 2].time}:${arr.length}` : '0';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the 5m closed bar + layers
  return useMemo(() => buildMaFvgSignalView(candlesByTf, full, smcByTf), [sig, full, smcByTf]);
}
