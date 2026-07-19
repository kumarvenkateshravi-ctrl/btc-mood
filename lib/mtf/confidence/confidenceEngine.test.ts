import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import type { AgreementResult } from '../agreement/agreementTypes';
import { computeConfidence } from './confidenceEngine';

const ind = (id: string, confidence: number): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict: 'bullish', confidence, strength: confidence,
  display: '—', diagnostics: { a: 1 }, signals: [], warnings: [], weight: 1,
});
const cat = (id: CategoryResult['id'], confidence: number, strength = confidence): CategoryResult => ({
  id, score: 50, verdict: 'bullish', confidence, strength, state: 'bullish' as CategoryResult['state'],
  contributors: [], diagnostics: { a: 1 }, signals: [], warnings: [],
});
const agr = (agreement: number, dominantShare: number, minorityShare: number, conflict = 0): AgreementResult => ({
  schemaVersion: 1, agreement, conflict, dominantBias: 'bullish', state: 'strong', consensus: 'strong_bullish',
  indicatorAgreement: agreement, categoryAgreement: agreement, contributors: [], signals: [], warnings: [],
  diagnostics: { bullishVotes: 0, bearishVotes: 0, neutralVotes: 0, agreementRatio: agreement / 100, dominantShare, minorityShare },
});
const factorCats = (conf: number) => [cat('trend', conf), cat('momentum', conf), cat('volume', conf), cat('participation', conf)];
const sumContribs = (r: { contributors: { contribution: number }[] }) => r.contributors.reduce((s, c) => s + c.contribution, 0);

describe('computeConfidence', () => {
  it('audit identity + controlled golden', () => {
    const indicators = [ind('ema', 90), ind('rsi', 90)];
    const categories = [...factorCats(80), cat('quality', 80, 100), cat('volatility', 80, 0)];
    const r = computeConfidence(indicators, categories, agr(90, 0.8, 0.1));
    // base: round(.3·90)=27 + round(.35·80)=28 + round(.35·81)=28 = 83; +8 completeness; weak_pillar cat: round(.4·(83−80))=1
    expect(r.diagnostics).toMatchObject({ indicatorConfidence: 90, categoryConfidence: 80, agreementConfidence: 81, evidence: 8, penalties: 1 });
    expect(r.confidence).toBe(90);
    expect(r.state).toBe('very_high');
    expect(sumContribs(r)).toBe(90); // Σ contributions === confidence (no clamp)
  });

  it('neutral consensus → low confidence', () => {
    const r = computeConfidence([ind('ema', 50), ind('rsi', 50)], factorCats(50), agr(96, 0.05, 0.04));
    expect(r.confidence).toBeLessThan(45);
    expect(['low', 'very_low']).toContain(r.state);
  });

  it('weak pillar materially reduces below the naive blend', () => {
    const r = computeConfidence([ind('ema', 94), ind('rsi', 94)], factorCats(40), agr(100, 0.9, 0.05));
    const naive = Math.round(0.3 * 94 + 0.35 * 40 + 0.35 * 90);
    expect(r.confidence).toBeLessThan(naive);
    expect(r.warnings.some((w) => w.code === 'CONF_WEAK_PILLAR')).toBe(true);
  });

  it('previousConfidence populates delta', () => {
    const r = computeConfidence([ind('ema', 90)], factorCats(80), agr(90, 0.8, 0.1), 60);
    expect(r.previousConfidence).toBe(60);
    expect(r.confidenceDelta).toBe(r.confidence - 60);
  });

  it('is deterministic', () => {
    const run = () => computeConfidence([ind('ema', 70)], factorCats(65), agr(80, 0.6, 0.2));
    expect(run()).toEqual(run());
  });
});
