import { describe, expect, it } from 'vitest';
import type { CategoryResult } from '../categoryTypes';
import type { AgreementResult } from '../agreement/agreementTypes';
import { computePenalties, type PenaltyContext } from './penalties';

const agr = (conflict: number, warnings: AgreementResult['warnings'] = []): AgreementResult => ({
  schemaVersion: 1, agreement: 80, conflict, dominantBias: 'bullish', state: 'strong', consensus: 'strong_bullish',
  indicatorAgreement: 80, categoryAgreement: 80, contributors: [], signals: [], warnings,
  diagnostics: { bullishVotes: 0, bearishVotes: 0, neutralVotes: 0, agreementRatio: 0.8, dominantShare: 0.8, minorityShare: 0.1 },
});
const cat = (id: CategoryResult['id'], strength: number): CategoryResult => ({
  id, score: 50, verdict: 'neutral', confidence: 50, strength, state: 'ranging' as CategoryResult['state'],
  contributors: [], diagnostics: {}, signals: [], warnings: [],
});
const ctx = (o: Partial<PenaltyContext>): PenaltyContext =>
  ({ agreement: agr(0), categories: [], base: 80, indConf: 80, catConf: 80, agrConf: 80, ...o });
const byId = (xs: { id: string; contribution: number }[], id: string) => xs.find((x) => x.id === id)?.contribution;

describe('computePenalties', () => {
  it('conflict scales', () => {
    expect(byId(computePenalties(ctx({ agreement: agr(60) })), 'conflict')).toBe(-9); // round(15·0.6)
  });
  it('layer mismatch is flat', () => {
    const p = computePenalties(ctx({ agreement: agr(0, [{ code: 'AGR_LAYER_MISMATCH', message: 'x', severity: 'warning', source: 'category' }]) }));
    expect(byId(p, 'layer_mismatch')).toBe(-10);
  });
  it('low quality proportional to weakness', () => {
    expect(byId(computePenalties(ctx({ categories: [cat('quality', 40)] })), 'low_quality')).toBe(-7); // round(12·0.6)
  });
  it('high volatility proportional to intensity', () => {
    expect(byId(computePenalties(ctx({ categories: [cat('volatility', 80)] })), 'high_volatility')).toBe(-8); // round(10·0.8)
  });
  it('weak-pillar limiter names the weakest pillar', () => {
    const p = computePenalties(ctx({ base: 76, indConf: 94, catConf: 90, agrConf: 42 }));
    const weak = p.find((x) => x.id.startsWith('weak_pillar'))!;
    expect(weak.id).toBe('weak_pillar:agreement');
    expect(weak.layer).toBe('agreement');
    expect(weak.contribution).toBe(-14); // round(0.4·(76−42))
  });
  it('all strong / balanced → no penalties', () => {
    expect(computePenalties(ctx({}))).toEqual([]);
  });
});
