import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { indicatorAgreement } from './indicatorAgreement';

const ind = (id: string, verdict: IndicatorResult['verdict'], confidence: number, weight = 1): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict, confidence, strength: confidence,
  display: '—', diagnostics: {}, signals: [], warnings: [], weight,
});

describe('indicatorAgreement', () => {
  it('all bull → agreement 100, dominant bullish, conflict 0', () => {
    const r = indicatorAgreement([ind('a', 'bullish', 80), ind('b', 'bullish', 60)]);
    expect(r.agreement).toBe(100);
    expect(r.dominantBias).toBe('bullish');
    expect(r.conflict).toBe(0);
  });

  it('all bear → dominant bearish', () => {
    expect(indicatorAgreement([ind('a', 'bearish', 70), ind('b', 'bearish', 50)]).dominantBias).toBe('bearish');
  });

  it('evenly mixed → conflict > 0, contributors carry weight×confidence', () => {
    const r = indicatorAgreement([ind('a', 'bullish', 50, 2), ind('b', 'bearish', 100)]);
    expect(r.conflict).toBeGreaterThan(0);
    expect(r.contributors).toEqual([
      { id: 'a', layer: 'indicator', vote: 'bullish', weight: 100 },
      { id: 'b', layer: 'indicator', vote: 'bearish', weight: 100 },
    ]);
  });

  it('mostly neutral → dominant neutral', () => {
    expect(indicatorAgreement([ind('a', 'neutral', 80), ind('b', 'neutral', 70), ind('c', 'bullish', 30)]).dominantBias).toBe('neutral');
  });

  it('empty → agreement 0, conflict 0, dominant neutral, no contributors', () => {
    const r = indicatorAgreement([]);
    expect(r.agreement).toBe(0);
    expect(r.conflict).toBe(0);
    expect(r.dominantBias).toBe('neutral');
    expect(r.contributors).toEqual([]);
  });
});
