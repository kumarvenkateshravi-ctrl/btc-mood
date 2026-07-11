import { describe } from 'vitest';
import { computeSmcOverlay } from './smcOverlay';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('SMC overlay golden master', () => {
  defineGoldenTest({
    name: 'smcOverlay',
    compute: computeSmcOverlay,
    params: { showFvg: true, showZones: true, debugMode: false },
    candleCount: 400,
    seed: 7,
  });
});
