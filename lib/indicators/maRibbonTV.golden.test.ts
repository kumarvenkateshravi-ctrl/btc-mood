import { describe } from 'vitest';
import { computeMaRibbonTV } from './maRibbonTV';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('MA Ribbon TV golden master', () => {
  defineGoldenTest({
    name: 'maRibbonTV',
    compute: computeMaRibbonTV,
    // Default params match the PineScript: SMA 20/50/100/200
    params: {
      showMa1: true, ma1Type: 'SMA', ma1Length: 20,
      showMa2: true, ma2Type: 'SMA', ma2Length: 50,
      showMa3: true, ma3Type: 'SMA', ma3Length: 100,
      showMa4: true, ma4Type: 'SMA', ma4Length: 200,
    },
  });
});
