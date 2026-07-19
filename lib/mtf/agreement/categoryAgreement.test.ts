import { describe, expect, it } from 'vitest';
import type { CategoryResult } from '../categoryTypes';
import { categoryAgreement } from './categoryAgreement';

const cat = (id: CategoryResult['id'], verdict: CategoryResult['verdict'], confidence: number): CategoryResult => ({
  id, score: 50, verdict, confidence, strength: confidence, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});

describe('categoryAgreement', () => {
  it('categories vote by confidence alone (weight defaults to 1)', () => {
    const r = categoryAgreement([cat('trend', 'bullish', 90), cat('momentum', 'bullish', 70)]);
    expect(r.agreement).toBe(100);
    expect(r.dominantBias).toBe('bullish');
    expect(r.contributors).toEqual([
      { id: 'trend', layer: 'category', vote: 'bullish', weight: 90 },
      { id: 'momentum', layer: 'category', vote: 'bullish', weight: 70 },
    ]);
  });

  it('non-directional (neutral) categories dilute agreement', () => {
    // trend/momentum/volume/participation bull, volatility+quality neutral
    const r = categoryAgreement([
      cat('trend', 'bullish', 80), cat('momentum', 'bullish', 80),
      cat('volume', 'bullish', 80), cat('participation', 'bullish', 80),
      cat('volatility', 'neutral', 80), cat('quality', 'neutral', 80),
    ]);
    expect(r.dominantBias).toBe('bullish');
    expect(r.agreement).toBeLessThan(100); // the two neutral categories reduce it
  });

  it('empty → neutral, agreement 0', () => {
    const r = categoryAgreement([]);
    expect(r.agreement).toBe(0);
    expect(r.dominantBias).toBe('neutral');
  });
});
