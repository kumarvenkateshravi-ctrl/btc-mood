// M9 — fractal swing detection. The only structure primitive the levels core
// needs: confirmed swing highs/lows on the execution timeframe's closed bars.

import type { Candle } from '../../types';
import { DECISION_CONFIG } from './config';

export interface SwingPoint {
  index: number;
  price: number;
}

/** Fractal swings: bar i is a swing high iff high[i] is STRICTLY greater than the
 *  highs of the k bars on each side (mirror for lows). Only confirmed swings count —
 *  the final k bars cannot confirm. */
export function findSwings(
  candles: Candle[],
  k = DECISION_CONFIG.swingConfirmBars,
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= k; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

export function lastConfirmedSwings(
  candles: Candle[],
  k = DECISION_CONFIG.swingConfirmBars,
): { swingHigh: SwingPoint | null; swingLow: SwingPoint | null } {
  const { highs, lows } = findSwings(candles, k);
  return { swingHigh: highs.at(-1) ?? null, swingLow: lows.at(-1) ?? null };
}
