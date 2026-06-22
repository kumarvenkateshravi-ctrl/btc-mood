import { describe } from 'vitest';
import { computeVwapBands } from './vwapBands';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('VWAP Bands golden master', () => {
  defineGoldenTest({
    name: 'vwapBands',
    compute: computeVwapBands,
    params: { mult1: 1, mult2: 2 },
  });
});
