// Shared anchored-VWAP core: cumulative volume-weighted mean + volume-weighted
// population standard deviation of the source around the VWAP, re-anchoring
// whenever the period key changes. Faithful to TradingView's VWAP — the exact
// math previously inlined in vwapBands.ts, extracted so both that indicator and
// the "Moving Averages & FVG" composite share one source of truth.

import type { Candle } from '../../types';
import { vwapPeriodKey, type VwapAnchor } from '../vwapAnchor';

/** Per-bar anchored VWAP and its band half-width unit (σ). */
export function anchoredVwap(
  candles: Candle[],
  src: number[],
  anchor: VwapAnchor,
): { vwap: (number | null)[]; sd: (number | null)[] } {
  const n = candles.length;
  const vwap = new Array<number | null>(n).fill(null);
  const sd = new Array<number | null>(n).fill(null);

  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  let period: number | null = null;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const key = vwapPeriodKey(c.time, anchor);
    if (key !== period) {
      cumPV = 0;
      cumV = 0;
      cumPV2 = 0;
      period = key;
    }
    const p = src[i];
    cumPV += p * c.volume;
    cumV += c.volume;
    cumPV2 += p * p * c.volume;

    if (cumV > 0) {
      const v = cumPV / cumV;
      const variance = Math.max(0, cumPV2 / cumV - v * v);
      vwap[i] = v;
      sd[i] = Math.sqrt(variance);
    }
  }

  return { vwap, sd };
}
