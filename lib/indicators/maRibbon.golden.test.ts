import { describe } from 'vitest';
import { computeMaRibbon } from './maRibbon';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('MA Ribbon golden master', () => {
  defineGoldenTest({
    name: 'maRibbon',
    compute: computeMaRibbon,
    params: { fast: 9, mid: 21, slow: 50 },
  });
});
