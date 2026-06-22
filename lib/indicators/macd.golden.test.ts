import { describe } from 'vitest';
import { computeMacd } from './macd';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('MACD golden master', () => {
  defineGoldenTest({
    name: 'macd',
    compute: computeMacd,
    params: { fast: 12, slow: 26, signal: 9 },
  });
});
