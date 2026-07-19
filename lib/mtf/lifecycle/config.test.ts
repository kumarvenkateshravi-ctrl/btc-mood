import { describe, expect, it } from 'vitest';
import { CYCLE_ORDER, LIFECYCLE_THRESHOLDS } from './config';

describe('lifecycle config', () => {
  it('cycle order is the full canonical sequence, range excluded', () => {
    expect(CYCLE_ORDER).toEqual([
      'accumulation', 'breakout', 'confirmation', 'trend_establishment',
      'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal',
    ]);
    expect(CYCLE_ORDER).not.toContain('range');
  });
  it('thresholds are all 0-100 or valid fractions', () => {
    for (const v of Object.values(LIFECYCLE_THRESHOLDS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
