// Volatility parsing — faithful port of the LuxAlgo preamble (SDD.md:310-330).
//
// highVolatilityBar = (high - low) >= 2 * measure, where measure is either
// Wilder ATR(200) or the cumulative mean true range (ta.cum(ta.tr)/bar_index).
// On a high-volatility bar the parsed high/low are SWAPPED (the script uses
// them to avoid anchoring order blocks to blow-off bars).

import type { Candle } from '@/lib/types';

export interface VolatilityContext {
  /** Wilder ATR(200); bar 0 seeds with high-low. */
  atr200: number[];
  /** Chosen measure per obFilter ('atr' → atr200, 'range' → cum mean TR). */
  measure: number[];
  /** highVolatilityBar ? low : high */
  parsedHighs: number[];
  /** highVolatilityBar ? high : low */
  parsedLows: number[];
  isHighVolatility: boolean[];
}

const ATR_LENGTH = 200;

export function computeVolatility(candles: Candle[], obFilter: 'atr' | 'range'): VolatilityContext {
  const n = candles.length;
  const atr200 = new Array<number>(n);
  const measure = new Array<number>(n);
  const parsedHighs = new Array<number>(n);
  const parsedLows = new Array<number>(n);
  const isHighVolatility = new Array<boolean>(n);

  let atr = 0;
  let cumTr = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const tr = i === 0
      ? c.high - c.low
      : Math.max(
          c.high - c.low,
          Math.abs(c.high - candles[i - 1].close),
          Math.abs(c.low - candles[i - 1].close),
        );

    // Wilder RMA seeded with the first TR.
    atr = i === 0 ? tr : (atr * (ATR_LENGTH - 1) + tr) / ATR_LENGTH;
    atr200[i] = atr;

    cumTr += tr;
    // Pine: ta.cum(ta.tr)/bar_index — bar_index is 0 on the first bar, so the
    // measure is undefined there; treat as NaN (never flags high volatility).
    const cumMean = i === 0 ? NaN : cumTr / i;

    const m = obFilter === 'atr' ? atr : cumMean;
    measure[i] = m;

    const hv = Number.isFinite(m) && c.high - c.low >= 2 * m;
    isHighVolatility[i] = hv;
    parsedHighs[i] = hv ? c.low : c.high;
    parsedLows[i] = hv ? c.high : c.low;
  }

  return { atr200, measure, parsedHighs, parsedLows, isHighVolatility };
}
