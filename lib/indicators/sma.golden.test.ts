import { describe } from 'vitest';
import { computeSma } from './sma';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('SMA golden master', () => {
  defineGoldenTest({
    name: 'sma',
    compute: computeSma,
    params: { length: 9, source: 'close' },
  });
});
