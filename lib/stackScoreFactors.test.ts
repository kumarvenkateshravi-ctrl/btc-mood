import { describe, it, expect } from 'vitest';
import { computeStackScoreFactors, volatilityScore, FACTOR_WEIGHT, type FactorInputs } from './stackScoreFactors';
import type { AlignmentMatrix, Verdict } from './alignment';
import type { Consensus, MarketStructure, TimeframeDetails } from './multiTimeframe';
import type { Timeframe } from './types';

const TFS: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

function matrixOf(sub: number, v: Verdict): AlignmentMatrix {
  const subRec: AlignmentMatrix['sub'] = {};
  const tfScore: AlignmentMatrix['tfScore'] = {};
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  for (const tf of TFS) {
    subRec[tf] = { ema: sub, supertrend: sub, rsi: sub, macd: sub, adx: sub, obv: sub, volume: sub };
    tfScore[tf] = sub; tfVerdict[tf] = v;
  }
  return { rows: [], tfScore, tfVerdict, sub: subRec };
}
const consensusOf = (bull: number): Consensus => ({ bull, bear: 6 - bull, neutral: 0, total: 6, pctBull: Math.round((bull / 6) * 100), overall: bull > 3 ? 'bullish' : bull < 3 ? 'bearish' : 'neutral' });
const structOf = (verdict: Verdict): MarketStructure => ({ label: 'x', sublabel: 'x', verdict });
const details: TimeframeDetails = {
  trend: { ema20: 1, ema50: 1, ema200: 1, verdict: 'bearish' },
  momentum: { rsi: 37.5, macd: -12, signal: -8, histogram: -4, verdict: 'bearish' },
  strength: { adx: 24, diPlus: 16, diMinus: 28, verdict: 'bearish' },
  volume: { current: 100, sma20: 200, vsPct: -56, verdict: 'bearish' },
};
const inputs = (sub: number, v: Verdict, atrPct: number, sentiment: number): FactorInputs => ({
  matrix: matrixOf(sub, v), consensus: consensusOf(v === 'bullish' ? 6 : v === 'bearish' ? 0 : 3),
  structure: structOf(v), details, atrPct, sentiment, price: 62_000, tfs: TFS,
});

describe('volatilityScore', () => {
  it('healthy ATR scores high, chaotic scores low', () => {
    expect(volatilityScore(0.8)).toBe(80);
    expect(volatilityScore(0.1)).toBe(55);
    expect(volatilityScore(3)).toBeLessThanOrEqual(40);
    expect(volatilityScore(1.75)).toBeCloseTo(50, 5);
  });
});

describe('weights', () => {
  it('the 7 factor weights sum to 1', () => {
    expect(Object.values(FACTOR_WEIGHT).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe('computeStackScoreFactors', () => {
  it('produces 7 factors', () => {
    expect(computeStackScoreFactors(inputs(50, 'neutral', 1.75, 50)).factors).toHaveLength(7);
  });

  it('all-bullish, max inputs → high score / STRONG BUY', () => {
    const r = computeStackScoreFactors(inputs(100, 'bullish', 0.8, 100));
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.recommendation).toBe('STRONG BUY');
    expect(r.direction).toBe('buy');
    expect(r.stars).toBe(5);
  });

  it('all-bearish, min inputs → low score / STRONG SELL', () => {
    const r = computeStackScoreFactors(inputs(0, 'bearish', 2.5, 0));
    expect(r.score).toBeLessThan(20);
    expect(r.recommendation).toBe('STRONG SELL');
    expect(r.direction).toBe('sell');
    expect(r.insights.length).toBeGreaterThan(0);
    expect(r.improvements).toHaveLength(5);
  });

  it('neutral mid → ~50 / NEUTRAL', () => {
    const r = computeStackScoreFactors(inputs(50, 'neutral', 1.75, 50));
    expect(r.score).toBe(50);
    expect(r.recommendation).toBe('NEUTRAL');
  });

  it('a bearish setup recommends shorting / staying out and sets invalidation above price', () => {
    const r = computeStackScoreFactors(inputs(22, 'bearish', 1.2, 28));
    expect(r.direction).toBe('sell');
    expect(r.bestAction).toMatch(/short|stay out/i);
    expect(r.invalidation).toMatch(/Above/);
  });
});
