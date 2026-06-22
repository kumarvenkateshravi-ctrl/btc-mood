import { describe } from 'vitest';
import { computeObv } from './obv';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('OBV golden master', () => {
  defineGoldenTest({ name: 'obv', compute: computeObv, params: {} });
});
