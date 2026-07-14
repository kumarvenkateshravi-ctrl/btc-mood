'use client';

// Stable analytics window: page-level analytics (mood engine, market context,
// scanner, SD signals) are LIVE-EDGE readers — they need the recent tail, not
// the 40,000-bar histories that deep-load and zoom-out lazy-loading accumulate.
// Feeding them full arrays caused a ~2s main-thread stall on every history
// prepend (all engines recomputed over everything, for bars that changed
// nothing at the live edge).
//
// This view caps each TF to the most recent ANALYTICS_MAX_BARS and — the
// important part — keeps REFERENTIAL STABILITY: if a TF's tail is unchanged
// (a prepend of older bars), the previous slice object is reused; if no TF
// changed, the previous OUTER object is returned, so every downstream useMemo
// skips without comparing contents.
//
// The chart is intentionally NOT windowed (scrollback needs full history);
// neither is the dedicated technical-scanner page's own feed (deep backtests).

import { useMemo, useRef } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '../types';

export const ANALYTICS_MAX_BARS = 1500;

export type CandlesByTfLike = Partial<Record<Timeframe, Candle[]>>;

/** Cheap change detector for a capped tail: length-in-window + edge bars.
 *  In-bar ticks change last.close/high/low → new signature (analytics must
 *  see live updates); prepends beyond the window leave it identical. */
export function tailSignature(arr: Candle[] | undefined, cap: number): string {
  if (!arr || arr.length === 0) return 'empty';
  const n = Math.min(arr.length, cap);
  const first = arr[arr.length - n];
  const last = arr[arr.length - 1];
  return `${n}:${first.time}:${last.time}:${last.close}:${last.high}:${last.low}`;
}

export interface WindowState {
  sigs: Partial<Record<Timeframe, string>>;
  out: CandlesByTfLike;
}

/** Pure step: compute the next window, reusing prior slices (and the prior
 *  outer object) wherever signatures match. */
export function stepAnalyticsWindow(
  prev: WindowState,
  candlesByTf: CandlesByTfLike,
  cap: number,
): WindowState {
  const out: CandlesByTfLike = {};
  const sigs: Partial<Record<Timeframe, string>> = {};
  let changed = false;
  for (const tf of TIMEFRAMES) {
    const arr = candlesByTf[tf];
    const sig = tailSignature(arr, cap);
    sigs[tf] = sig;
    if (prev.sigs[tf] === sig) {
      out[tf] = prev.out[tf]; // may legitimately be undefined for absent TFs
    } else {
      out[tf] = !arr ? undefined : arr.length > cap ? arr.slice(-cap) : arr;
      changed = true;
    }
  }
  return changed ? { sigs, out } : prev;
}

/** Hook wrapper with a ref-carried state so identity survives re-renders.
 *  Generic over the input's completeness: a full Record in yields a full
 *  Record out (every TF key is re-assigned each step). */
export function useAnalyticsWindow<T extends CandlesByTfLike>(
  candlesByTf: T,
  cap: number = ANALYTICS_MAX_BARS,
): T {
  const stateRef = useRef<WindowState>({ sigs: {}, out: {} });
  return useMemo(() => {
    stateRef.current = stepAnalyticsWindow(stateRef.current, candlesByTf, cap);
    return stateRef.current.out as T;
  }, [candlesByTf, cap]);
}
