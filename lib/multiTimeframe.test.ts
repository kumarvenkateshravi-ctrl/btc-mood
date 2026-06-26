import { describe, it, expect } from 'vitest';
import {
  computeConsensus, computeWeightedScore, buildSummary, detectStructure, TF_WEIGHT,
} from './multiTimeframe';
import type { AlignmentMatrix, Verdict } from './alignment';
import type { Candle, Timeframe } from './types';

const TFS: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

function matrixOf(scoreByTf: Record<Timeframe, number>, verdictByTf: Record<Timeframe, Verdict>): AlignmentMatrix {
  const sub: AlignmentMatrix['sub'] = {};
  const tfScore: AlignmentMatrix['tfScore'] = {};
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  for (const tf of TFS) {
    const s = scoreByTf[tf];
    sub[tf] = { ema: s, supertrend: s, rsi: s, macd: s, adx: s, obv: s, volume: s };
    tfScore[tf] = s;
    tfVerdict[tf] = verdictByTf[tf];
  }
  return { rows: [], tfScore, tfVerdict, sub };
}
const uniform = (score: number, v: Verdict) =>
  matrixOf(Object.fromEntries(TFS.map((t) => [t, score])) as Record<Timeframe, number>, Object.fromEntries(TFS.map((t) => [t, v])) as Record<Timeframe, Verdict>);

describe('computeConsensus', () => {
  it('all bearish → 0/6 bullish', () => {
    const c = computeConsensus(uniform(20, 'bearish'), TFS);
    expect(c.bull).toBe(0);
    expect(c.bear).toBe(6);
    expect(c.total).toBe(6);
    expect(c.pctBull).toBe(0);
    expect(c.overall).toBe('bearish');
  });
  it('4 bullish / 2 bearish → 4/6, overall bullish', () => {
    const verds = { '5m': 'bullish', '15m': 'bullish', '30m': 'bullish', '1h': 'bullish', '4h': 'bearish', '1d': 'bearish' } as Record<Timeframe, Verdict>;
    const c = computeConsensus(matrixOf(Object.fromEntries(TFS.map((t) => [t, 60])) as Record<Timeframe, number>, verds), TFS);
    expect(c.bull).toBe(4);
    expect(c.pctBull).toBe(67);
    expect(c.overall).toBe('bullish');
  });
});

describe('computeWeightedScore', () => {
  it('weights match the spec and sum to 1', () => {
    expect(Object.values(TF_WEIGHT).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it('applies the per-TF weights', () => {
    const scores = { '5m': 31, '15m': 55, '30m': 22, '1h': 42, '4h': 15, '1d': 38 } as Record<Timeframe, number>;
    const w = computeWeightedScore(matrixOf(scores, Object.fromEntries(TFS.map((t) => [t, 'bearish'])) as Record<Timeframe, Verdict>), TFS);
    // 31*.1 + 55*.15 + 22*.15 + 42*.2 + 15*.2 + 38*.2 = 33.65 → 34
    expect(w.overall).toBe(34);
    expect(w.outlook).toBe('bearish');
    expect(w.perTf).toHaveLength(6);
  });
  it('all-100 → 100 / bullish', () => {
    const w = computeWeightedScore(uniform(100, 'bullish'), TFS);
    expect(w.overall).toBe(100);
    expect(w.outlook).toBe('bullish');
  });
});

describe('buildSummary', () => {
  it('maps band scores and a clean overall label', () => {
    const m = uniform(30, 'bearish');
    const s = buildSummary(m, computeWeightedScore(m, TFS));
    expect(s.shortTerm.label).toBe('Strong Bearish');
    expect(s.outlook.label).toBe('Bearish');
    expect(s.outlook.verdict).toBe('bearish');
  });
});

describe('detectStructure', () => {
  const swing = (n: number, base: number, trend: number): Candle[] =>
    Array.from({ length: n }, (_, i) => {
      const close = base + i * trend + 5 * Math.sin(i * 0.6);
      return { time: i * 300, open: close, high: close + 1.5, low: close - 1.5, close, volume: 1000 };
    });

  it('rising swings → bull trend (HH/HL)', () => {
    expect(detectStructure(swing(60, 100, 1)).verdict).toBe('bullish');
  });
  it('falling swings → bear trend (LH/LL)', () => {
    expect(detectStructure(swing(60, 300, -1)).verdict).toBe('bearish');
  });
  it('too few bars → neutral range', () => {
    expect(detectStructure(swing(10, 100, 1)).verdict).toBe('neutral');
  });
});
