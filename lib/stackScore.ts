// Stack Score Engine — the proprietary score from the dashboard spec (Phase 6).
// Aggregates the alignment matrix into six weighted components, then a 0–100
// Stack Score, a recommendation, a star rating and the timeframe consensus.
//
//   score = trend*0.25 + momentum*0.20 + volume*0.15 + adx*0.15
//         + supertrend*0.15 + consensus*0.10
//
// The score is a *bullishness* reading: 100 = maximally bullish, 0 = bearish,
// 50 = neutral. Pure + unit-tested.

import type { Timeframe } from './types';
import type { AlignmentMatrix, Verdict } from './alignment';

export type Recommendation =
  | 'STRONG BUY' | 'BUY' | 'MODERATE' | 'NEUTRAL' | 'WEAK SELL' | 'SELL' | 'STRONG SELL';

export interface StackScoreComponents {
  trend: number;
  momentum: number;
  volume: number;
  adx: number;
  supertrend: number;
  consensus: number;
}

export interface StackScore {
  score: number; // 0–100 bullishness
  recommendation: Recommendation;
  direction: 'buy' | 'sell' | 'neutral';
  stars: number; // 1–5
  components: StackScoreComponents;
  bullCount: number;
  bearCount: number;
  neutralCount: number;
  totalTf: number;
}

const WEIGHTS = { trend: 0.25, momentum: 0.2, volume: 0.15, adx: 0.15, supertrend: 0.15, consensus: 0.1 };

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);

function recommend(score: number): Recommendation {
  if (score >= 80) return 'STRONG BUY';
  if (score >= 65) return 'BUY';
  if (score >= 55) return 'MODERATE';
  if (score >= 45) return 'NEUTRAL';
  if (score >= 35) return 'WEAK SELL';
  if (score >= 20) return 'SELL';
  return 'STRONG SELL';
}

function starsFor(score: number): number {
  if (score >= 80) return 5;
  if (score >= 60) return 4;
  if (score >= 40) return 3;
  if (score >= 20) return 2;
  return 1;
}

export function computeStackScore(matrix: AlignmentMatrix, tfs: Timeframe[]): StackScore {
  const active = tfs.filter((tf) => matrix.sub[tf]);

  const trend = avg(active.map((tf) => matrix.sub[tf]!.ema));
  const supertrend = avg(active.map((tf) => matrix.sub[tf]!.supertrend));
  const momentum = avg(active.map((tf) => (matrix.sub[tf]!.rsi + matrix.sub[tf]!.macd) / 2));
  const volume = avg(active.map((tf) => matrix.sub[tf]!.volume));
  const adx = avg(active.map((tf) => matrix.sub[tf]!.adx));

  const verdicts: Verdict[] = active.map((tf) => matrix.tfVerdict[tf] ?? 'neutral');
  const bullCount = verdicts.filter((v) => v === 'bullish').length;
  const bearCount = verdicts.filter((v) => v === 'bearish').length;
  const neutralCount = verdicts.filter((v) => v === 'neutral').length;
  const total = active.length || 1;
  // Directional consensus: all-bull → 100, all-bear → 0, split → 50.
  const consensus = 50 + ((bullCount - bearCount) / total) * 50;

  const components: StackScoreComponents = { trend, momentum, volume, adx, supertrend, consensus };

  const raw =
    trend * WEIGHTS.trend +
    momentum * WEIGHTS.momentum +
    volume * WEIGHTS.volume +
    adx * WEIGHTS.adx +
    supertrend * WEIGHTS.supertrend +
    consensus * WEIGHTS.consensus;

  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const direction: StackScore['direction'] = score >= 55 ? 'buy' : score <= 45 ? 'sell' : 'neutral';

  return {
    score,
    recommendation: recommend(score),
    direction,
    stars: starsFor(score),
    components,
    bullCount,
    bearCount,
    neutralCount,
    totalTf: active.length,
  };
}
