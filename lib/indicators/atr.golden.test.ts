import { describe } from 'vitest';
import { computeAtr } from './atr';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('ATR golden master', () => {
  defineGoldenTest({ name: 'atr', compute: computeAtr, params: { length: 14 } });
});
