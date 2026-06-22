import { describe } from 'vitest';
import { computeRsi } from './rsi';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('RSI golden master', () => {
  defineGoldenTest({ name: 'rsi', compute: computeRsi, params: { length: 14 } });
});
