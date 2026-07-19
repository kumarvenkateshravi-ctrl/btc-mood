import { describe, expect, it } from 'vitest';
import { tally, agreementFrom, dominanceFrom, contributorsOf } from './vote';
import type { Voter } from './agreementTypes';

const v = (id: string, verdict: Voter['verdict'], confidence: number, weight?: number): Voter =>
  ({ id, verdict, confidence, weight });

describe('tally', () => {
  it('sums (weight ?? 1) × confidence per bucket', () => {
    const t = tally([v('a', 'bullish', 80, 2), v('b', 'bearish', 50), v('c', 'neutral', 40)]);
    expect(t.bull).toBe(160);
    expect(t.bear).toBe(50);
    expect(t.neutral).toBe(40);
    expect(t.total).toBe(250);
    expect(t.bullFrac).toBeCloseTo(0.64, 5);
  });
  it('empty → zeros', () => {
    expect(tally([])).toEqual({ bull: 0, bear: 0, neutral: 0, total: 0, bullFrac: 0, bearFrac: 0, neutralFrac: 0 });
  });
});

describe('agreementFrom', () => {
  it('dominant share with neutral in the denominator', () => {
    // 6 bull × conf 90 = 540; 1 neutral × conf 60 = 60; total 600 → 540/600 = 90
    const voters = [...Array(6).fill(0).map((_, i) => v(`b${i}`, 'bullish', 90)), v('n', 'neutral', 60)];
    expect(agreementFrom(tally(voters))).toBe(90);
  });
  it('unanimous → 100; empty → 0', () => {
    expect(agreementFrom(tally([v('a', 'bearish', 70), v('b', 'bearish', 30)]))).toBe(100);
    expect(agreementFrom(tally([]))).toBe(0);
  });
});

describe('dominanceFrom', () => {
  it('strict directional max; ties and neutral-max → neutral', () => {
    expect(dominanceFrom({ bull: 3, bear: 1, neutral: 2 })).toBe('bullish');
    expect(dominanceFrom({ bull: 1, bear: 3, neutral: 2 })).toBe('bearish');
    expect(dominanceFrom({ bull: 2, bear: 2, neutral: 1 })).toBe('neutral');
    expect(dominanceFrom({ bull: 1, bear: 1, neutral: 5 })).toBe('neutral');
    expect(dominanceFrom({ bull: 0, bear: 0, neutral: 0 })).toBe('neutral');
  });
});

describe('contributorsOf', () => {
  it('maps to { id, layer, vote, weight×confidence }', () => {
    expect(contributorsOf([v('ema', 'bullish', 80, 2)], 'indicator'))
      .toEqual([{ id: 'ema', layer: 'indicator', vote: 'bullish', weight: 160 }]);
    expect(contributorsOf([v('trend', 'bearish', 70)], 'category'))
      .toEqual([{ id: 'trend', layer: 'category', vote: 'bearish', weight: 70 }]);
  });
});
