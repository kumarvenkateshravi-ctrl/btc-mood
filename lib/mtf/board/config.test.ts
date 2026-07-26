import { describe, expect, it } from 'vitest';
import { BOARD_CONFIG, BOARD_TF_WEIGHTS } from './config';

describe('M-Board config', () => {
  it('freezes the v1 defaults exactly', () => {
    expect(BOARD_CONFIG).toEqual({
      minConviction: 55,
      strengthBuckets: { strong: 60, moderate: 30 },
      dissentPenaltyWeight: 0.3,
      strongDissentThreshold: 0.5,
    });
  });

  it('execution-primary weights: the 5m/15m/30m cluster carries the majority (0.80)', () => {
    expect(BOARD_TF_WEIGHTS).toEqual({
      '5m': 0.30, '15m': 0.30, '30m': 0.20, '1h': 0.10, '4h': 0.06, '1d': 0.04,
    });
    const total = Object.values(BOARD_TF_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    const execution = BOARD_TF_WEIGHTS['5m'] + BOARD_TF_WEIGHTS['15m'] + BOARD_TF_WEIGHTS['30m'];
    const higher = BOARD_TF_WEIGHTS['1h'] + BOARD_TF_WEIGHTS['4h'] + BOARD_TF_WEIGHTS['1d'];
    expect(execution).toBeGreaterThan(higher);
  });
});
