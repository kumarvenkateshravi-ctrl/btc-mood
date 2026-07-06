// Determinism lock for the Volume Distribution Zones indicator.
// Record / refresh: UPDATE_GOLDEN=1 npx vitest run volumeDistributionZones.golden
import { describe } from 'vitest';
import { computeVolumeDistributionZones } from './volumeDistributionZones';
import { defineGoldenTest } from '../testing/goldenRunner';

describe('volume_distribution_zones golden master', () => {
  defineGoldenTest({
    name: 'volumeDistributionZones',
    compute: computeVolumeDistributionZones,
    params: { tf1: 'D', tf2: '4H', tf3: 'None', thrBase: 10 },
    candleCount: 400,
    seed: 11,
  });
});
