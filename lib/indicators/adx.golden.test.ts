import { describe, it, expect } from 'vitest';
import { computeAdx } from './adx';
import { defineGoldenTest } from '../testing/goldenRunner';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

describe('ADX golden master', () => {
  defineGoldenTest({
    name: 'adx',
    compute: computeAdx,
    params: { diLength: 14, adxSmoothing: 14 },
  });

  // Sanity invariants for the hand-port, independent of the snapshot.
  it('keeps ADX and DI within 0–100', () => {
    const candles = makeDeterministicCandles(200, 3);
    const result = computeAdx(candles);
    for (const plot of result.plots) {
      for (const v of plot.data) {
        if (v !== null && typeof v === 'number') {
          expect(v).toBeGreaterThanOrEqual(-1e-9);
          expect(v).toBeLessThanOrEqual(100 + 1e-9);
        }
      }
    }
  });
});
