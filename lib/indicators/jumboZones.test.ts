import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeJumboZones, median, expansionZones } from './jumboZones';

const DAY = 86400;
const oc = (time: number, o: number, h: number, l: number): Candle => ({ time, open: o, high: h, low: l, close: o, volume: 1 });

describe('median', () => {
  it('odd / even / unsorted / empty', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('expansionZones', () => {
  it('matches the creator worked example (O 64000, EB 780, ES 760, 21/29/53/62)', () => {
    const z = expansionZones(64000, 780, 760, [21, 29], [53, 62]);
    expect(z.R1.lower).toBeCloseTo(64163.8, 6); expect(z.R1.upper).toBeCloseTo(64226.2, 6);
    expect(z.R2.lower).toBeCloseTo(64413.4, 6); expect(z.R2.upper).toBeCloseTo(64483.6, 6);
    expect(z.S1.lower).toBeCloseTo(63779.6, 6); expect(z.S1.upper).toBeCloseTo(63840.4, 6);
    expect(z.S2.lower).toBeCloseTo(63528.8, 6); expect(z.S2.upper).toBeCloseTo(63597.2, 6);
  });
  it('validates crossing percentiles via min/max (never flips)', () => {
    const z = expansionZones(1000, 100, 100, [35, 29], [53, 62]);
    expect(z.R1.lower).toBeLessThan(z.R1.upper);
    expect(z.R1.lower).toBeCloseTo(1029, 6); // min(1035, 1029)
    expect(z.R1.upper).toBeCloseTo(1035, 6);
  });
});

describe('computeJumboZones', () => {
  const find = (candles: Candle[], id: string) => computeJumboZones(candles).plots.find((p) => p.id === id)!;
  // 3 one-bar sessions. day0 bull=700 bear=740; day1 bull=860 bear=780;
  // day2 target (open 64000). median bull(700,860)=780, bear(740,780)=760 → doc example.
  const CANDLES = [
    oc(0, 63000, 63700, 62260),           // day0: bull 700, bear 740
    oc(DAY, 63500, 64360, 62720),          // day1: bull 860, bear 780
    oc(2 * DAY, 64000, 64010, 63990),      // day2: target session (open 64000)
  ];

  it('empty candles → no plots, no throw', () => {
    expect(() => computeJumboZones([])).not.toThrow();
    expect(computeJumboZones([]).plots).toEqual([]);
  });

  it('day-2 zones use the previous session\'s expansion + today\'s open (default 1-day lookback)', () => {
    // Default sessionLookback = 1 → day2 uses ONLY day1 (bull 860, bear 780), open 64000.
    // R1 = [64000+860*0.21, 64000+860*0.29] = [64180.6, 64249.4]
    // S2 = [64000-780*0.62, 64000-780*0.53] = [63516.4, 63586.6]
    const r1 = find(CANDLES, 'R1'); const s2 = find(CANDLES, 'S2');
    expect(r1.data[0]).toBeNull(); // day0: no prior session
    expect(r1.data[1]).not.toBeNull(); // day1: has day0 prior
    const r1d2 = r1.data[2] as { upper: number; lower: number };
    expect(r1d2.lower).toBeCloseTo(64180.6, 6);
    expect(r1d2.upper).toBeCloseTo(64249.4, 6);
    const s2d2 = s2.data[2] as { upper: number; lower: number };
    expect(s2d2.lower).toBeCloseTo(63516.4, 6);
    expect(s2d2.upper).toBeCloseTo(63586.6, 6);
    expect(r1.type).toBe('band');
    expect(r1.zoneStyle).toEqual({ boundary: 'lower', lineStyle: 'solid', emphasis: 0 });
    expect(find(CANDLES, 'S1').zoneStyle).toEqual({ boundary: 'upper', lineStyle: 'solid', emphasis: 0 });
  });

  it('multi-session median lookback averages prior sessions (matches the doc example)', () => {
    // sessionLookback 2 → day2 uses day0+day1: median bull(700,860)=780, bear(740,780)=760.
    const cfg = { sessionLookback: 2 } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const r1 = computeJumboZones(CANDLES, cfg).plots.find((p) => p.id === 'R1')!;
    const r1d2 = r1.data[2] as { upper: number; lower: number };
    expect(r1d2.lower).toBeCloseTo(64163.8, 6);
    expect(r1d2.upper).toBeCloseTo(64226.2, 6);
  });

  it('symmetric mode uses (EB+ES)/2 both sides', () => {
    // Default lookback 1 → day2 uses day1 (bull 860, bear 780). E = (860+780)/2 = 820.
    // R1 = [64000+820*0.21, 64000+820*0.29] = [64172.2, 64237.8]
    const cfg = { expansionMode: 'symmetric' } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const r1 = computeJumboZones(CANDLES, cfg).plots.find((p) => p.id === 'R1')!;
    const r1d2 = r1.data[2] as { upper: number; lower: number };
    expect(r1d2.lower).toBeCloseTo(64172.2, 6);
    expect(r1d2.upper).toBeCloseTo(64237.8, 6);
  });

  it('emits R1/R2/S1/S2 bands + PIVOT/PIVOT_P lines, all overlay', () => {
    const plots = computeJumboZones(CANDLES).plots;
    expect(plots.map((p) => p.id).sort()).toEqual(['PIVOT', 'PIVOT_P', 'R1', 'R2', 'S1', 'S2']);
    for (const p of plots) {
      const expected = (p.id === 'PIVOT' || p.id === 'PIVOT_P') ? 'line' : 'band';
      expect(p.type).toBe(expected);
      expect(p.pane).toBe('overlay');
    }
  });

  it('pivots: anchor = prev close, HLC/3 = prev-day aggregate', () => {
    // Multi-bar day1 so index 1 is NOT the day's last bar (pivot lines null the
    // boundary bar; a 1-bar day would null the only bar). day0 close = 63000.
    const PIV = [
      oc(0, 63000, 63700, 62260),          // day0 (close 63000, high 63700, low 62260)
      oc(DAY, 63500, 63600, 63400),        // day1 bar A (first, non-boundary)
      oc(DAY + 300, 63550, 63700, 63450),  // day1 bar B (last of day1)
    ];
    const pivot = find(PIV, 'PIVOT'); const pp = find(PIV, 'PIVOT_P');
    expect(pivot.data[1]).toBe(63000); // day1 anchor = day0 close
    expect((pp.data[1] as number)).toBeCloseTo((63700 + 62260 + 63000) / 3, 6);
  });

  it('respects show toggles (hide support + pivots)', () => {
    const cfg = { showSupport: false, showPivot: false, showPivotP: false } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const ids = computeJumboZones(CANDLES, cfg).plots.map((p) => p.id);
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('PIVOT');
    expect(ids).not.toContain('PIVOT_P');
    expect(ids).toContain('R1');
  });
});
