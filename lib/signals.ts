import type { Candle, Signal, Timeframe } from './types';
import * as its from 'indicatorts';
import { pad } from './indicatorCompute';

export interface Regime {
  label: 'calm' | 'normal' | 'hot';
  atrPct: number; // ATR(14) as a percentage of the close
}

export interface TFSnapshot {
  tf: Timeframe;
  signal: Signal;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  regime: Regime | null;
  confluenceScore: number; // -3..+3, internal per-tf agreement
}

const MIN_BARS: Record<Timeframe, number> = {
  '5m': 90,
  '15m': 100,
  '30m': 100,
  '1h': 100,
  '4h': 100,
  '1d': 100,
};

/**
 * Score a signal from its indicator inputs. Shared by `computeSignal`
 * (per-timeframe verdict) and the chart's per-bar BUY/SELL markers, so
 * the markers can never drift from the verdict.
 *   - EMA9 vs EMA21 gap → direction (±1)
 *   - RSI(14) → a non-vetoing lean (extreme 80/20 = ±1, 60/40 = ±0.5)
 *   - side: buy when score ≥ 0.5, sell when ≤ -0.5, else neutral
 */
export function scoreSignal(
  ema9: number | null,
  ema21: number | null,
  rsi14: number | null,
): { side: Signal['side']; confluenceScore: number } {
  let dirScore = 0;
  if (ema9 != null && ema21 != null && ema21 !== 0) {
    const gap = (ema9 - ema21) / ema21; // signed, e.g. +0.0042 = +0.42%
    dirScore = gap > 0 ? 1 : gap < 0 ? -1 : 0;
  }

  let rsiScore = 0;
  if (rsi14 != null) {
    if (rsi14 >= 80) rsiScore = -1;
    else if (rsi14 <= 20) rsiScore = 1;
    else if (rsi14 > 60) rsiScore = 0.5;
    else if (rsi14 < 40) rsiScore = -0.5;
  }

  const confluenceScore = dirScore + rsiScore;
  const side: Signal['side'] =
    confluenceScore >= 0.5 ? 'buy' : confluenceScore <= -0.5 ? 'sell' : 'neutral';
  return { side, confluenceScore };
}

/**
 * Compute the trading signal for a single timeframe using:
 *   - EMA(9) vs EMA(21) crossover for direction
 *   - RSI(14) for extremes confirmation (relaxed veto only)
 *   - ATR(14) as a percentage of close for volatility regime context
 *
 * `now` is used to decide whether the latest bar is "fresh" enough to
 * trust the signal (avoids a 7-minute-stale 1m bar looking current).
 */
export function computeSignal(
  tf: Timeframe,
  candles: Candle[],
  now: number = Math.floor(Date.now() / 1000),
): TFSnapshot {
  const empty: TFSnapshot = {
    tf,
    signal: { side: 'neutral', source: 'v1', fresh: false },
    ema9: null,
    ema21: null,
    rsi14: null,
    regime: null,
    confluenceScore: 0,
  };

  if (candles.length < MIN_BARS[tf]) return empty;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const e9 = pad(its.ema(closes, { period: 9 }), closes.length);
  const e21 = pad(its.ema(closes, { period: 21 }), closes.length);
  const r14 = pad(its.rsi(closes, { period: 14 }), closes.length);
  const a14 = pad(its.atr(highs, lows, closes, { period: 14 }).atrLine, closes.length);

  const i = closes.length - 1;
  const ema9 = e9[i];
  const ema21 = e21[i];
  const rsi14 = r14[i];
  const atr14 = a14[i];

  const { side, confluenceScore } = scoreSignal(ema9, ema21, rsi14);

  // Volatility regime: ATR% < 0.4% calm, 0.4–1.2% normal, > 1.2% hot.
  let regime: Regime | null = null;
  if (atr14 != null && closes[i] !== 0) {
    const atrPct = (atr14 / closes[i]) * 100;
    const label: Regime['label'] =
      atrPct < 0.4 ? 'calm' : atrPct > 1.2 ? 'hot' : 'normal';
    regime = { label, atrPct };
  }

  // Freshness: a bar isn't "fresh" if it's much older than its interval.
  const lastBar = candles[candles.length - 1];
  const barAge = Math.max(0, now - lastBar.time);
  const fresh = barAge <= FRESH_THRESHOLD_HOURS[tf] * 3600;

  return {
    tf,
    signal: { side, source: 'ema+rsi', fresh },
    ema9,
    ema21,
    rsi14,
    regime,
    confluenceScore,
  };
}

/**
 * Aggregate per-tf snapshots into a header-level "mood" verdict.
 * Higher-timeframe votes carry more weight.
 */
export interface MoodVerdict {
  side: 'bullish' | 'bearish' | 'neutral';
  bullishCount: number; // 0..n, raw count of TFs voting buy
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  weightedBull: number;
  weightedBear: number;
  weightedNeut: number;
  totalWeight: number;
  summary: string; // e.g. "4/6 bullish"
}

const FRESH_THRESHOLD_HOURS: Record<Timeframe, number> = {
  '5m': 0.5, // 30m
  '15m': 1,
  '30m': 2,
  '1h': 4,
  '4h': 12,
  '1d': 72,
};

const TF_WEIGHT: Record<Timeframe, number> = {
  '5m': 0.75,
  '15m': 1,
  '30m': 1.25,
  '1h': 1.5,
  '4h': 2,
  '1d': 2.5,
};

export function aggregateMood(snapshots: TFSnapshot[]): MoodVerdict {
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let wBull = 0;
  let wBear = 0;
  let wNeut = 0;
  let total = 0;
  for (const s of snapshots) {
    const w = TF_WEIGHT[s.tf];
    total += w;
    if (s.signal.side === 'buy') {
      bullishCount += 1;
      wBull += w;
    } else if (s.signal.side === 'sell') {
      bearishCount += 1;
      wBear += w;
    } else {
      neutralCount += 1;
      wNeut += w;
    }
  }
  const side: MoodVerdict['side'] =
    wBull > wBear && wBull > wNeut
      ? 'bullish'
      : wBear > wBull && wBear > wNeut
      ? 'bearish'
      : 'neutral';
  const totalCount = bullishCount + bearishCount + neutralCount;
  return {
    side,
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    weightedBull: wBull,
    weightedBear: wBear,
    weightedNeut: wNeut,
    totalWeight: total,
    summary: `${bullishCount}/${totalCount} bullish`,
  };
}
