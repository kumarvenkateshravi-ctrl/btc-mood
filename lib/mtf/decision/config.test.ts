import { describe, expect, it } from 'vitest';
import { DECISION_CONFIG, PRIOR_TIER_CAP } from './config';

describe('M9 decision config', () => {
  it('freezes the v1 defaults exactly', () => {
    expect(DECISION_CONFIG).toEqual({
      atrLength: 14,
      swingConfirmBars: 2,
      entryZoneAtrMult: 0.25,
      stopAtrMult: 1.0,
      targetRR: 2.0,
      minRR: 1.5,
      smcSnapToleranceAtrMult: 0.5,
      stopExtendMaxAtrMult: 0.75,
      stopBufferAtrMult: 0.1,
      minCandles: 20,
    });
    expect(PRIOR_TIER_CAP).toBe('half');
  });
});
