// lib/indicators/sdZones.test.ts
import { describe, it, expect } from 'vitest';
import { buildZones, summarizeZones, computeSdZones } from './sdZones';
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

describe('intraday supply/demand zones', () => {
  const mk = (n: number, stepSec: number): Candle[] =>
    Array.from({ length: n }, (_, i) => {
      const base = 100 + Math.sin(i / 7) * 5;
      return {
        time: 1_700_000_000 + i * stepSec,
        open: base, close: base + 1, high: base + 2, low: base - 1, volume: 10,
      };
    });

  it('builds 1H zones from 5m candles (one set per completed hour)', () => {
    const candles = mk(12 * 6, 300); // 6 hours of 5m bars
    const zones = buildZones(candles, '1H', 1.5);
    // first completed hour yields zones starting at hour 2; 4 kinds per period
    expect(zones.length).toBeGreaterThanOrEqual(4 * 4);
    expect(zones.length % 4).toBe(0);
    const supply = zones.filter((z) => z.kind === 'supply');
    // zone geometry comes from the PRIOR hour's OHLC
    for (const z of supply) expect(z.upper).toBeGreaterThanOrEqual(z.lower);
  });

  it('skips HTF periods smaller than the chart interval, keeps equal and larger', () => {
    // 1h chart: 15M is sub-bar noise (skipped); 1H = prior-period zones
    // (kept, like 4H-on-4h or D-on-daily); 4H is a true higher TF (kept).
    const candles = mk(60, 3600);
    const res = computeSdZones(candles, {
      id: 'sd',
      settings: { inputs: { tf1: '15M', tf2: '1H', tf3: '4H' } },
    } as never);
    expect(res.plots.length).toBe(8); // 1H + 4H, 4 kinds each
    expect(res.plots.some((p) => p.id.startsWith('1H'))).toBe(true);
    expect(res.plots.some((p) => p.id.startsWith('4H'))).toBe(true);
    expect(res.plots.some((p) => p.id.startsWith('15M'))).toBe(false);
  });

  it('keeps 4H zones on the 4h chart (prior-period zones — the reported bug)', () => {
    const candles = mk(80, 14400);
    const res = computeSdZones(candles, {
      id: 'sd',
      settings: { inputs: { tf1: '4H', tf2: 'None', tf3: 'None' } },
    } as never);
    expect(res.plots.length).toBe(4);
    expect(res.plots.every((p) => p.id.startsWith('4H'))).toBe(true);
    // and the bands actually contain data
    expect(res.plots.some((p) => p.data.some((d) => d != null))).toBe(true);
  });

  it('renders intraday zone plots with dashed styling on a 5m chart', () => {
    const candles = mk(12 * 8, 300);
    const res = computeSdZones(candles, {
      id: 'sd',
      settings: { inputs: { tf1: '1H', tf2: 'None', tf3: 'None' } },
    } as never);
    expect(res.plots.length).toBe(4);
    expect(res.plots[0].id.startsWith('1H')).toBe(true);
    for (const p of res.plots) {
      expect((p.zoneStyle as { lineStyle?: string }).lineStyle).toBe('dashed');
    }
  });
});
