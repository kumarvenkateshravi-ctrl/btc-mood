import { describe } from 'vitest';
import { computeWilliamsR } from './williamsR';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Williams %R golden master', () => {
  defineGoldenTest({
    name: 'williamsR',
    compute: computeWilliamsR,
    params: { length: 14, source: 'close' },
  });
});
