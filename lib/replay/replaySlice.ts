// Replay-aware multi-timeframe slicing (Prime Invariant enforcement).
//
// "Now" during replay is the CLOSE of the current replay bar on the eval
// timeframe. For every other timeframe:
//   - bars fully closed by "now" are kept as stored;
//   - a higher-TF bar still forming at "now" is SYNTHESIZED from the eval-TF
//     slice inside its window — the stored historical bar already contains
//     the rest of its hour/day, which would leak intra-bar future data;
//   - everything else is dropped.

import type { Candle, Timeframe } from '../types';

export const TF_SECONDS: Record<Timeframe, number> = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/** Rightmost index with candles[i].time <= t, or -1. */
function searchRightmost(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Bars that opened at or before `t` (inclusive). */
export function sliceAtTime(candles: Candle[], t: number): Candle[] {
  const idx = searchRightmost(candles, t);
  return idx < 0 ? [] : candles.slice(0, idx + 1);
}

/**
 * Slice every timeframe at the replay moment. `cutBar` is the current replay
 * bar on `evalTf`; now = cutBar.time + interval(evalTf).
 */
export function sliceCandlesByTf<T extends Partial<Record<Timeframe, Candle[]>>>(
  candlesByTf: T,
  evalTf: Timeframe,
  cutBar: Candle,
): T {
  const now = cutBar.time + TF_SECONDS[evalTf];
  const evalSlice = sliceAtTime(candlesByTf[evalTf] ?? [], cutBar.time);

  const out: Partial<Record<Timeframe, Candle[]>> = {};
  for (const key of Object.keys(candlesByTf) as Timeframe[]) {
    const series = candlesByTf[key];
    if (!series || series.length === 0) {
      out[key] = series;
      continue;
    }
    const interval = TF_SECONDS[key] ?? TF_SECONDS['15m'];

    // Fully closed bars: time + interval <= now  ⇔  time <= now - interval.
    const closedEnd = searchRightmost(series, now - interval);
    const sliced = series.slice(0, closedEnd + 1);

    // Forming higher-TF bar: opened before now, closes after now. Rebuild it
    // from the eval-TF slice inside its window instead of leaking the stored
    // (fully formed) historical bar.
    if (interval > TF_SECONDS[evalTf]) {
      const formingIdx = closedEnd + 1;
      const forming = series[formingIdx];
      if (forming && forming.time < now) {
        const parts = evalSlice.filter((c) => c.time >= forming.time && c.time < now);
        if (parts.length > 0) {
          sliced.push({
            time: forming.time,
            open: parts[0].open,
            high: Math.max(...parts.map((c) => c.high)),
            low: Math.min(...parts.map((c) => c.low)),
            close: parts[parts.length - 1].close,
            volume: parts.reduce((s, c) => s + c.volume, 0),
          });
        }
      }
    }

    out[key] = sliced;
  }
  // Every key of the input is mapped, so the input's shape is preserved.
  return out as T;
}
