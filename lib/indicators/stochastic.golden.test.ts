import { describe } from 'vitest';
import { computeStochastic } from './stochastic';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Stochastic golden master', () => {
  defineGoldenTest({
    name: 'stochastic',
    compute: computeStochastic,
    params: { kPeriod: 14, smoothK: 3, dPeriod: 3 },
  });
});
