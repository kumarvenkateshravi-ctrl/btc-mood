import { describe, expect, it } from 'vitest';
import type { OutcomeProbability } from './probabilityTypes';
import { explainProbability } from './explanation';

const outcomes = (xs: Array<[OutcomeProbability['outcome'], number]>): OutcomeProbability[] =>
  xs.map(([outcome, probability]) => ({ outcome, probability }));
const ctx = (o: Partial<Parameters<typeof explainProbability>[0]>) => ({
  calibration: 'prior' as const,
  mostLikelyOutcome: { outcome: 'continuation' as const, probability: 0.5 },
  marketOutcomes: outcomes([['continuation', 0.5], ['pullback', 0.3], ['reversal', 0.2]]),
  ...o,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('explainProbability', () => {
  it('PROB_MODEL_PRIORS always present while calibration is prior', () => {
    expect(codes(explainProbability(ctx({})).signals)).toContain('PROB_MODEL_PRIORS');
    expect(codes(explainProbability(ctx({ calibration: 'empirical' })).signals)).not.toContain('PROB_MODEL_PRIORS');
  });
  it('high conviction fires at ≥ 0.65', () => {
    expect(codes(explainProbability(ctx({ mostLikelyOutcome: { outcome: 'continuation', probability: 0.7 } })).signals)).toContain('PROB_HIGH_CONVICTION');
    expect(codes(explainProbability(ctx({})).signals)).not.toContain('PROB_HIGH_CONVICTION');
  });
  it('uncertain warns below 0.40', () => {
    expect(codes(explainProbability(ctx({ mostLikelyOutcome: { outcome: 'range', probability: 0.35 } })).warnings)).toContain('PROB_UNCERTAIN');
  });
  it('reversal elevated warns when reversal or false_breakout ≥ 0.25', () => {
    expect(codes(explainProbability(ctx({ marketOutcomes: outcomes([['continuation', 0.6], ['reversal', 0.3]]) })).warnings)).toContain('PROB_REVERSAL_ELEVATED');
    expect(codes(explainProbability(ctx({ marketOutcomes: outcomes([['continuation', 0.6], ['false_breakout', 0.28]]) })).warnings)).toContain('PROB_REVERSAL_ELEVATED');
    expect(codes(explainProbability(ctx({})).warnings)).not.toContain('PROB_REVERSAL_ELEVATED');
  });
});
