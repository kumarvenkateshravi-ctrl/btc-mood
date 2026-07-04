// Higher-timeframe resampling for zone/pivot indicators. Pure, UTC-aligned;
// crypto is 24/7 so there is no exchange session or holiday calendar.

import type { Candle } from '../types';

export type HtfPeriod = '4H' | 'D' | 'W' | 'M';

export interface HtfBucketOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: number; // unix seconds of the period's first bar
}

const SEC_4H = 14400;
const SEC_DAY = 86400;

/** UTC-aligned period index for a bar's unix-second timestamp. */
export function periodKey(timeSec: number, period: HtfPeriod): number {
  if (period === '4H') return Math.floor(timeSec / SEC_4H);
  if (period === 'D') return Math.floor(timeSec / SEC_DAY);
  if (period === 'W') {
    // Monday-start weeks. Epoch day 0 (1970-01-01) is a Thursday, so the
    // Monday on/before it is day -3; +3 shifts the boundary to Monday.
    const days = Math.floor(timeSec / SEC_DAY);
    return Math.floor((days + 3) / 7);
  }
  // 'M' — UTC calendar month.
  const d = new Date(timeSec * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * For each base candle, the OHLC of the PREVIOUS fully-completed HTF period
 * (or null until at least one prior period has closed). Non-repainting: a bar
 * only ever sees periods whose key differs from its own, so no lookahead.
 */
export function priorPeriodOHLC(
  candles: Candle[],
  period: HtfPeriod,
): (HtfBucketOHLC | null)[] {
  const n = candles.length;
  const out = new Array<HtfBucketOHLC | null>(n).fill(null);
  if (n === 0) return out;

  let curKey = periodKey(candles[0].time, period);
  let cur: HtfBucketOHLC = {
    open: candles[0].open, high: candles[0].high, low: candles[0].low,
    close: candles[0].close, volume: candles[0].volume, startTime: candles[0].time,
  };
  let prev: HtfBucketOHLC | null = null;

  for (let i = 0; i < n; i++) {
    const k = periodKey(candles[i].time, period);
    if (k !== curKey) {
      prev = cur; // the just-finished bucket is now the completed prior period
      curKey = k;
      cur = {
        open: candles[i].open, high: candles[i].high, low: candles[i].low,
        close: candles[i].close, volume: candles[i].volume, startTime: candles[i].time,
      };
    } else if (i > 0) {
      cur.high = Math.max(cur.high, candles[i].high);
      cur.low = Math.min(cur.low, candles[i].low);
      cur.close = candles[i].close;
      cur.volume += candles[i].volume;
    }
    out[i] = prev;
  }
  return out;
}
