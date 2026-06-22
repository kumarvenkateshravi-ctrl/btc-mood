import { describe } from 'vitest';
import { computeBollingerBands } from './bollingerBands';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Bollinger Bands golden master', () => {
  defineGoldenTest({
    name: 'bollingerBands',
    compute: computeBollingerBands,
    params: { length: 20, mult: 2 },
  });
});
