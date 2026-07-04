// lib/indicators/sdZones.test.ts
import { describe, it, expect } from 'vitest';
import { buildZones, summarizeZones } from './sdZones';
import type { Candle } from '../types';

const DAY = 86400;
// day 0: range 90..110, body 100..105 ; then later days below.
const series: Candle[] = [
  { time: 0, open: 100, high: 110, low: 90, close: 105, volume: 10 },
  { time: 3600, open: 105, high: 110, low: 95, close: 108, volume: 10 },
  { time: DAY, open: 108, high: 109, low: 92, close: 96, volume: 5 },   // day 1 -> zones from day 0
  { time: DAY + 3600, open: 96, high: 98, low: 93, close: 94, volume: 5 },
  { time: 2 * DAY, open: 94, high: 95, low: 80, close: 85, volume: 5 }, // day 2 -> zones from day 1
];

describe('buildZones', () => {
  it('freezes 4 zones per period from the prior period OHLC with targetFactor', () => {
    const zones = buildZones(series, 'D', 1.5);
    // First formation is at index 2 (day 1), from day 0: o100 h110 l90 c105.
    const day1 = zones.filter((z) => z.formedAtIndex === 2);
    const byKind = Object.fromEntries(day1.map((z) => [z.kind, z]));
    // range = 20; bodyBottom 100. bodyTop uses the day-0 BUCKET's close (108,
    // from the second bar in that bucket — priorPeriodOHLC uses "last close in
    // the period wins", per htf.test.ts), not bar 0's own close (105).
    expect(byKind.supply).toMatchObject({ upper: 110, lower: 108 });
    expect(byKind.demand).toMatchObject({ upper: 100, lower: 90 });
    expect(byKind.supplyTarget).toMatchObject({ upper: 110 + 20 * 1.5, lower: 110 });
    expect(byKind.demandTarget).toMatchObject({ upper: 90, lower: 90 - 20 * 1.5 });
  });
  it('produces no zones before the second period', () => {
    const oneDay = series.slice(0, 2);
    expect(buildZones(oneDay, 'D', 1.5)).toEqual([]);
  });
});

describe('summarizeZones', () => {
  it('emits engine fields for the current active zones', () => {
    const out = summarizeZones(series, { tfs: ['D'], targetFactor: 1.5 });
    expect(out.length).toBeGreaterThan(0);
    const s = out[0];
    expect(s).toHaveProperty('zoneStrength');
    expect(s).toHaveProperty('zoneType');
    expect(s).toHaveProperty('distanceToPrice');
    expect(s).toHaveProperty('isMultiTimeframeConfluence');
    expect(s).toHaveProperty('retestCount');
    expect(['supply', 'demand']).toContain(s.zoneType);
    // distanceToPrice is a signed % from the last close (85) to the zone mid.
    expect(typeof s.distanceToPrice).toBe('number');
  });
});
