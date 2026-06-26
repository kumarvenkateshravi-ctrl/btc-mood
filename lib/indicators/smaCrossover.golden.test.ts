import { describe } from 'vitest';
import { computeSMACrossover } from './smaCrossover';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('SMA Crossover + BB golden master', () => {
  defineGoldenTest({
    name: 'smaCrossover',
    compute: computeSMACrossover,
    params: { fastLen: 9, slowLen: 21, maType: 'EMA', useTrendFilter: true, useBBFilter: false, showBB: true, bbLen: 20, bbMult: 2.0 },
  });
});
