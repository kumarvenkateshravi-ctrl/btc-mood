import { describe } from 'vitest';
import { computeParabolicSar } from './parabolicSar';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Parabolic SAR golden master', () => {
  defineGoldenTest({
    name: 'parabolicSar',
    compute: computeParabolicSar,
    params: { start: 0.02, increment: 0.02, max: 0.2 },
  });
});
