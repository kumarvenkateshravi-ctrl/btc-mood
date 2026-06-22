import { describe } from 'vitest';
import { computeKeltnerChannels } from './keltnerChannels';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('Keltner Channels golden master', () => {
  defineGoldenTest({
    name: 'keltnerChannels',
    compute: computeKeltnerChannels,
    params: { length: 20, mult: 2, atrLength: 10 },
  });
});
