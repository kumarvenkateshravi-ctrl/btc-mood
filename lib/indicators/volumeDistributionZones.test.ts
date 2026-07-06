import { describe, it, expect } from 'vitest';
import { computeVolumeDistributionZones, computeVdZoneObjects } from './volumeDistributionZones';
import type { Candle } from '../types';

function synth(): Candle[] {
  const cs: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 24 * 8; i++) {
    p = Math.max(1, p + Math.sin(i / 9) * 1.5 + 0.1);
    cs.push({
      time: 1_600_000_000 + i * 3600,
      open: p - 0.3, high: p + 1, low: p - 1, close: p,
      volume: 500 + (i % 24) * 40,
    } as Candle);
  }
  return cs;
}

describe('computeVolumeDistributionZones', () => {
  it('returns the framework shape: band + wavg plots per (tf, kind), per-bar signals', () => {
    const bars = synth();
    const res = computeVolumeDistributionZones(bars, { id: 'volume_distribution_zones' });
    expect(res.signals.length).toBe(bars.length);
    const ids = res.plots.map((p) => p.id);
    expect(ids).toContain('D Supply');
    expect(ids).toContain('D Demand');
    expect(ids).toContain('D Supply WAvg');
    expect(ids).toContain('4H Demand');
    const band = res.plots.find((p) => p.id === 'D Supply')!;
    expect(band.type).toBe('band');
    expect(band.zoneStyle?.boundary).toBe('lower');
    expect(band.zoneStyle?.mid).toBe(true);
    const fourH = res.plots.find((p) => p.id === '4H Supply')!;
    expect(fourH.zoneStyle?.lineStyle).toBe('dashed');
  });

  it('display toggles blank the corresponding data', () => {
    const bars = synth();
    const res = computeVolumeDistributionZones(bars, {
      id: 'volume_distribution_zones',
      settings: { inputs: { showSupply: false, showWavg: false }, styles: {}, visibility: {} },
    } as never);
    const su = res.plots.find((p) => p.id === 'D Supply')!;
    expect(su.data.every((d) => d === null)).toBe(true);
    const wavg = res.plots.find((p) => p.id === 'D Demand WAvg')!;
    expect(wavg.data.every((d) => d === null)).toBe(true);
    // Demand bands still present.
    const de = res.plots.find((p) => p.id === 'D Demand')!;
    expect(de.data.some((d) => d !== null)).toBe(true);
  });

  it('emission boundary returns structured VdZone objects and caches on closed bars', () => {
    const bars = synth();
    const a = computeVdZoneObjects(bars, { id: 'volume_distribution_zones' });
    const b = computeVdZoneObjects(bars, { id: 'volume_distribution_zones' });
    expect(b.zones).toBe(a.zones); // cache hit → same reference
    expect(a.zones.length).toBeGreaterThan(0);
    for (const z of a.zones) {
      expect(z.upper).toBeGreaterThan(z.lower);
      expect(z.confidence).toBeGreaterThanOrEqual(0);
      expect(z.confidence).toBeLessThanOrEqual(100);
    }
  });
});
