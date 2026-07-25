import { describe, expect, it } from 'vitest';
import { BOARD_CONFIG } from './config';

describe('M-Board config', () => {
  it('freezes the v1 defaults exactly', () => {
    expect(BOARD_CONFIG).toEqual({
      minConviction: 55,
      strengthBuckets: { strong: 60, moderate: 30 },
      dissentPenaltyWeight: 0.3,
      strongDissentThreshold: 0.5,
    });
  });
});
