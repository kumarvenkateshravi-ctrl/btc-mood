import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import { computeEvidence } from './evidence';

const ind = (id: string, diagnostics: object): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict: 'neutral', confidence: 60, strength: 60,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const cat = (id: CategoryResult['id'], confidence: number, strength: number): CategoryResult => ({
  id, score: 50, verdict: 'neutral', confidence, strength, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});

describe('computeEvidence', () => {
  it('full data → completeness 1, +8', () => {
    const r = computeEvidence([ind('ema', { a: 1 }), ind('rsi', { a: 1 })], [cat('trend', 80, 70)]);
    expect(r.completeness).toBe(1);
    expect(r.contributors).toEqual([{ id: 'data_completeness', layer: 'indicator', kind: 'evidence', contribution: 8 }]);
  });
  it('half silent → +4', () => {
    // silent indicator (no diagnostics) + silent category (conf 50/str 0), plus one rich of each → 2/4
    const r = computeEvidence([ind('ema', {}), ind('rsi', { a: 1 })], [cat('trend', 50, 0), cat('momentum', 80, 70)]);
    expect(r.completeness).toBe(0.5);
    expect(r.contributors[0].contribution).toBe(4);
  });
  it('all silent → 0, no contributor', () => {
    const r = computeEvidence([ind('ema', {})], [cat('trend', 50, 0)]);
    expect(r.completeness).toBe(0);
    expect(r.contributors).toEqual([]);
  });
});
