import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { indicatorConfidence } from './indicatorConfidence';

const ind = (id: string, confidence: number, weight = 1): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict: 'neutral', confidence, strength: confidence,
  display: '—', diagnostics: {}, signals: [], warnings: [], weight,
});

describe('indicatorConfidence', () => {
  it('weight-weighted mean of confidences', () => {
    // (80·2 + 20·1) / 3 = 180/3 = 60
    expect(indicatorConfidence([ind('a', 80, 2), ind('b', 20, 1)])).toBe(60);
  });
  it('uniform → that value', () => {
    expect(indicatorConfidence([ind('a', 90), ind('b', 90)])).toBe(90);
  });
  it('single indicator', () => {
    expect(indicatorConfidence([ind('a', 73)])).toBe(73);
  });
  it('empty → 0', () => {
    expect(indicatorConfidence([])).toBe(0);
  });
});
