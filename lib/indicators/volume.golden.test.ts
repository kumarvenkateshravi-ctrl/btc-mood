import { describe } from 'vitest';
import { computeVolume } from './volume';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Volume golden master', () => {
  defineGoldenTest({ name: 'volume', compute: computeVolume, params: {} });
});
