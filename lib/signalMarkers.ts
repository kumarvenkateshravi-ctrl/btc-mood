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
  ema9: number;
  ema21: number;
  rsi14: number;
  atrPct: number;
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
  
  const tr = closes.map((c, i) => {
    if (i === 0) return candles[i].high - candles[i].low;
    const prevC = closes[i - 1];
    return Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevC),
      Math.abs(candles[i].low - prevC)
    );
  });
  const atr = pad(its.rma(tr, { period: 14 }), closes.length);

  const flips: SignalFlip[] = [];
  let lastEmitted: 'buy' | 'sell' | null = null;

  for (let i = MIN_BARS - 1; i < candles.length; i++) {
    const { side } = scoreSignal(e9[i], e21[i], r14[i]);
    if (side === 'neutral') continue;
    if (side !== lastEmitted) {
      flips.push({ 
        time: candles[i].time, 
        side, 
        ema9: e9[i] ?? 0, 
        ema21: e21[i] ?? 0, 
        rsi14: r14[i] ?? 0, 
        atrPct: atr[i] != null && closes[i] > 0 ? (atr[i]! / closes[i]) * 100 : 0
      });
      lastEmitted = side;
    }
  }

  return flips;
}
