import { describe } from 'vitest';
import { computeVwap } from './vwap';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('VWAP golden master', () => {
  defineGoldenTest({ name: 'vwap', compute: computeVwap, params: {} });
});
