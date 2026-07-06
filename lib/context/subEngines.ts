// Market Context Engine — Trend / Momentum / Volume sub-engines (MTFPlan
// Phases 4-6). Each blends already-computed producer scores with its own
// structure/slope math into an independent 0-100 score. Closed bars only.

import type { Candle } from '../types';
import { vdAtr } from '../indicators/vdEngine';
import { blendScores, clamp } from './scoringEngine';
import type { ContextIndicatorScore, ContextWeights } from './types';

type Scores = Record<keyof ContextWeights, ContextIndicatorScore>;

/** Market structure: higher-highs / higher-lows over the last 40 closed bars
 *  (recent 20 vs prior 20). 0 / 25 / 50 / 75 / 100. */
export function structureScore(candles: Candle[]): number {
  const n = candles.length;
  if (n < 40) return 50;
  let recentH = -Infinity, priorH = -Infinity, recentL = Infinity, priorL = Infinity;
  for (let i = n - 20; i < n; i++) {
    recentH = Math.max(recentH, candles[i].high);
    recentL = Math.min(recentL, candles[i].low);
  }
  for (let i = n - 40; i < n - 20; i++) {
    priorH = Math.max(priorH, candles[i].high);
    priorL = Math.min(priorL, candles[i].low);
  }
  let s = 50;
  s += recentH > priorH ? 25 : -25; // higher high vs lower high
  s += recentL > priorL ? 25 : -25; // higher low vs lower low
  return clamp(s, 0, 100);
}

/** Close slope over `bars`, normalized by ATR, mapped to 0-100. */
export function slopeScore(candles: Candle[], bars = 10): number {
  const n = candles.length;
  if (n < bars + 1) return 50;
  const a = vdAtr(candles)[n - 1] ?? 0;
  if (a <= 0) return 50;
  const slope = (candles[n - 1].close - candles[n - 1 - bars].close) / (bars * a);
  return 50 + 50 * clamp(slope * 2, -1, 1); // ±0.5 ATR/bar saturates
}

/** Trend = EMA 40 · Supertrend 30 · structure 15 · ADX 15. */
export function trendEngine(candles: Candle[], s: Scores): number {
  return blendScores([
    { score: s.ema.score, weight: 40 },
    { score: s.supertrend.score, weight: 30 },
    { score: structureScore(candles), weight: 15 },
    { score: s.adx.score, weight: 15 },
  ]);
}

/** Momentum = MACD 40 · RSI 30 · slope 20 · acceleration 10. */
export function momentumEngine(candles: Candle[], s: Scores): number {
  const slopeNow = slopeScore(candles, 5);
  const slopePrev = slopeScore(candles.slice(0, Math.max(0, candles.length - 5)), 5);
  const accel = clamp(50 + (slopeNow - slopePrev), 0, 100);
  return blendScores([
    { score: s.macd.score, weight: 40 },
    { score: s.rsi.score, weight: 30 },
    { score: slopeScore(candles, 10), weight: 20 },
    { score: accel, weight: 10 },
  ]);
}

/** Volume = OBV 40 · vol-vs-SMA20 (direction-signed) 30 · delta 20 · spike 10. */
export function volumeEngine(candles: Candle[], s: Scores): number {
  const n = candles.length;
  let ratioScore = 50;
  let spikeScore = 50;
  if (n >= 21) {
    let sum = 0;
    for (let i = n - 21; i < n - 1; i++) sum += candles[i].volume;
    const avg = sum / 20;
    const last = candles[n - 1];
    const dir = last.close >= last.open ? 1 : -1;
    if (avg > 0) {
      const ratio = last.volume / avg;
      ratioScore = 50 + dir * 50 * clamp(ratio - 1, 0, 1);
      spikeScore = ratio >= 1.8 ? 50 + dir * 50 : 50;
    }
  }
  return blendScores([
    { score: s.obv.score, weight: 40 },
    { score: ratioScore, weight: 30 },
    { score: s.volume.score, weight: 20 },
    { score: spikeScore, weight: 10 },
  ]);
}
