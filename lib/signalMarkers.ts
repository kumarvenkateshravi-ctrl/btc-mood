// Per-bar BUY/SELL flips for the chart's signal markers. Replays the
// shared `scoreSignal` rule across the candle history and emits a flip
// only when the buy/sell state actually changes (neutral stretches in
// between don't re-fire), so the chart stays readable. Pure + framework
// free: the component maps these to lightweight-charts markers.

import * as its from 'indicatorts';
import { pad } from './indicatorCompute';
import { scoreSignal } from './signals';
import type { Candle } from './types';

export interface SignalFlip {
  time: number;
  side: 'buy' | 'sell';
}

// Match computeSignal's warm-up: it returns neutral until a timeframe
// has at least 30 bars, so the first signal can land at index 29.
const MIN_BARS = 30;

export function buildSignalFlips(candles: Candle[]): SignalFlip[] {
  if (candles.length < MIN_BARS) return [];

  const closes = candles.map((c) => c.close);
  const e9 = pad(its.ema(closes, { period: 9 }), closes.length);
  const e21 = pad(its.ema(closes, { period: 21 }), closes.length);
  const r14 = pad(its.rsi(closes, { period: 14 }), closes.length);

  const flips: SignalFlip[] = [];
  let lastEmitted: 'buy' | 'sell' | null = null;

  for (let i = MIN_BARS - 1; i < candles.length; i++) {
    const { side } = scoreSignal(e9[i], e21[i], r14[i]);
    if (side === 'neutral') continue;
    if (side !== lastEmitted) {
      flips.push({ time: candles[i].time, side });
      lastEmitted = side;
    }
  }

  return flips;
}
