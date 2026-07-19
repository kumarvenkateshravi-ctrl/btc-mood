import { describe, expect, it } from 'vitest';
import { PROBABILITY_MODEL_VERSION, TRANSITION_PRIORS, TRANSITION_PRIOR_OVERRIDES } from './priors';
import { OPPORTUNITY_GRADES, PROB_THRESHOLDS } from './config';

describe('probability priors', () => {
  it('base transition priors sum to 1', () => {
    const sum = Object.values(TRANSITION_PRIORS).reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('every stage override, merged over the base, still sums to 1', () => {
    for (const [stage, override] of Object.entries(TRANSITION_PRIOR_OVERRIDES)) {
      const merged = { ...TRANSITION_PRIORS, ...override };
      const sum = Object.values(merged).reduce((s, p) => s + p, 0);
      expect(sum, `override for ${stage}`).toBeCloseTo(1, 10);
    }
  });

  it('model version is 1.0 (prior calibration)', () => {
    expect(PROBABILITY_MODEL_VERSION).toBe('1.0');
  });

  it('grade thresholds are strictly descending; probability thresholds sane', () => {
    expect(OPPORTUNITY_GRADES.A).toBeGreaterThan(OPPORTUNITY_GRADES.B);
    expect(OPPORTUNITY_GRADES.B).toBeGreaterThan(OPPORTUNITY_GRADES.C);
    expect(PROB_THRESHOLDS.highConviction).toBeGreaterThan(PROB_THRESHOLDS.uncertain);
  });
});
