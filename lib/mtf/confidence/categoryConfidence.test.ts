import { describe, expect, it } from 'vitest';
import type { CategoryResult } from '../categoryTypes';
import { categoryConfidence } from './categoryConfidence';

const cat = (id: CategoryResult['id'], confidence: number, strength = confidence): CategoryResult => ({
  id, score: 50, verdict: 'neutral', confidence, strength, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});

describe('categoryConfidence', () => {
  it('weighted mean over the factor categories', () => {
    // trend 90·0.30 + momentum 60·0.25 + volume 40·0.20 + participation 80·0.25 = 27+15+8+20 = 70
    expect(categoryConfidence([cat('trend', 90), cat('momentum', 60), cat('volume', 40), cat('participation', 80)])).toBe(70);
  });
  it('ignores non-directional categories (quality/volatility)', () => {
    const base = [cat('trend', 80), cat('momentum', 80), cat('volume', 80), cat('participation', 80)];
    expect(categoryConfidence([...base, cat('quality', 10), cat('volatility', 95)])).toBe(80);
  });
  it('renormalizes over present factor categories', () => {
    expect(categoryConfidence([cat('trend', 90), cat('momentum', 70)])).toBe(Math.round((90 * 0.3 + 70 * 0.25) / 0.55));
  });
  it('no factor categories → 0', () => {
    expect(categoryConfidence([cat('quality', 80), cat('volatility', 80)])).toBe(0);
    expect(categoryConfidence([])).toBe(0);
  });
});
