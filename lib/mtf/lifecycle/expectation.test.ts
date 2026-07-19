import { describe, expect, it } from 'vitest';
import { expectNext } from './expectation';
import { LIFECYCLE_THRESHOLDS } from './config';

describe('expectNext', () => {
  it('maps every stage to its expected next stage', () => {
    expect(expectNext('accumulation', 0).expected).toBe('breakout');
    expect(expectNext('breakout', 0).expected).toBe('confirmation');
    expect(expectNext('confirmation', 0).expected).toBe('trend_establishment');
    expect(expectNext('trend_establishment', 0).expected).toBe('healthy_pullback');
    expect(expectNext('healthy_pullback', 0).expected).toBe('continuation');
    expect(expectNext('exhaustion', 0).expected).toBe('distribution');
    expect(expectNext('distribution', 0).expected).toBe('reversal');
    expect(expectNext('reversal', 0).expected).toBe('accumulation');
    expect(expectNext('range', 0).expected).toBe('breakout');
  });

  it('continuation branches on exhaustion threshold', () => {
    expect(expectNext('continuation', LIFECYCLE_THRESHOLDS.exhaustHigh - 1).expected).toBe('healthy_pullback');
    expect(expectNext('continuation', LIFECYCLE_THRESHOLDS.exhaustHigh).expected).toBe('exhaustion');
  });

  it('every rationale is a non-empty string', () => {
    for (const stage of ['accumulation', 'breakout', 'confirmation', 'trend_establishment', 'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal', 'range'] as const) {
      expect(expectNext(stage, 50).rationale.length).toBeGreaterThan(0);
    }
  });
});
