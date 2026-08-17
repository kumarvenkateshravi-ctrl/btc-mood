import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeElephantZone, niceSnap, gridScaleFor } from './elephantZone';

const DAY = 86400;
const bar = (time: number, close: number): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });

describe('computeElephantZone (adaptive grid)', () => {
  const find = (candles: Candle[], id: string) => computeElephantZone(candles).plots.find((p) => p.id === id)!;

  it('empty candles → no plots, no throw', () => {
    expect(() => computeElephantZone([])).not.toThrow();
    expect(computeElephantZone([]).plots).toEqual([]);
  });

  it('volatility mode: R/S drawn as equal-width bands centered on base ± k·step', () => {
    // day 0: closes 96 & 110 → high 111, low 95, range 16; avg range(day1)=16
    // step = niceSnap(16·0.25)=niceSnap(4)=5; anchor(day1)=110; base=round(110/5)*5=110
    // zone half-width = (step · 0.3)/2 = (5·0.3)/2 = 0.75
    const candles = [
      bar(0, 96), bar(DAY - 100, 110),       // day 0
      bar(DAY, 200), bar(DAY + 100, 201),    // day 1
    ];
    const r1 = find(candles, 'R1'); const s1 = find(candles, 'S1'); const base = find(candles, 'BASE');
    expect(r1.data[0]).toBeNull(); // day 0 has no prior day → no grid
    expect(r1.data[1]).toBeNull();
    expect(r1.data[2]).toEqual({ upper: 115.75, lower: 114.25 }); // level 115 ± 0.75
    expect(r1.data[3]).toEqual({ upper: 115.75, lower: 114.25 });
    expect(s1.data[2]).toEqual({ upper: 105.75, lower: 104.25 }); // level 105 ± 0.75
    expect(base.data[2]).toBe(110); // base stays a line
    expect(r1.type).toBe('band');
    expect(r1.zoneStyle).toEqual({ boundary: 'lower', lineStyle: 'solid', emphasis: 0 });
    expect(s1.zoneStyle).toEqual({ boundary: 'upper', lineStyle: 'solid', emphasis: 0 });
    expect(base.lineStyle).toBe('dashed');
  });

  it('emits R1-4/S1-4 as bands, BASE/PIVOT/PIVOT_P as lines, all on the overlay pane', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const plots = computeElephantZone(candles).plots;
    expect(plots.map((p) => p.id).sort()).toEqual(['BASE', 'PIVOT', 'PIVOT_P', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']);
    for (const p of plots) {
      const expected = (p.id === 'BASE' || p.id === 'PIVOT' || p.id === 'PIVOT_P') ? 'line' : 'band';
      expect(p.type).toBe(expected);
      expect(p.pane).toBe('overlay');
    }
  });

  it('anchor pivot = previous close; HLC/3 pivot = prev-day aggregate (H+L+C)/3', () => {
    // day 0: closes 96,110 → high 111, low 95, close 110 → HLC/3 = (111+95+110)/3 = 105.333…
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200), bar(DAY + 100, 201)];
    expect(find(candles, 'PIVOT').data[2]).toBe(110);
    expect(find(candles, 'PIVOT_P').data[2]).toBeCloseTo((111 + 95 + 110) / 3, 6);
  });

  it('resets grid each UTC day; a later day uses more prior-day ranges', () => {
    const candles = [
      bar(0, 96), bar(DAY - 100, 110),        // day0 range 16
      bar(DAY, 108), bar(2 * DAY - 100, 120),  // day1 range: high 121, low 107 = 14
      bar(2 * DAY, 200),                        // day2
    ];
    // day2 anchor = 120; avg range over days 0,1 = (16+14)/2 = 15; step=niceSnap(15*0.25=3.75)=2.5
    // base = round(120/2.5)*2.5 = 120; R1 level 122.5 ± (2.5·0.3)/2 = ±0.375
    expect(find(candles, 'BASE').data[4]).toBe(120);
    expect(find(candles, 'R1').data[4]).toEqual({ upper: 122.875, lower: 122.125 });
  });

  it('round mode produces exact round-number levels', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const round = { spacingMode: 'round' } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const plots = computeElephantZone(candles, round).plots;
    const base = plots.find((p) => p.id === 'BASE')!;
    const r1 = plots.find((p) => p.id === 'R1')!;
    // anchor 110 → roundBase 10, step 2, base 110; R1 level 112 ± (2·0.3)/2 = ±0.3
    expect(base.data[2]).toBe(110);
    expect(r1.data[2]).toEqual({ upper: 112.3, lower: 111.7 });
  });

  it('respects show toggles (hide support + pivots)', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const cfg = { showSupport: false, showPivot: false, showPivotP: false } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const ids = computeElephantZone(candles, cfg).plots.map((p) => p.id);
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('PIVOT');
    expect(ids).not.toContain('PIVOT_P');
    expect(ids).toContain('R1');
  });
});

describe('niceSnap', () => {
  it('snaps to the nearest 1 / 2 / 2.5 / 5 / 10 x 10^k', () => {
    expect(niceSnap(1.3)).toBe(1);
    expect(niceSnap(2)).toBe(2);
    expect(niceSnap(3.4)).toBe(2.5);
    expect(niceSnap(6)).toBe(5);
    expect(niceSnap(8)).toBe(10);
    expect(niceSnap(173)).toBe(200);
    expect(niceSnap(0.006)).toBe(0.005);
    expect(niceSnap(0.007)).toBe(0.01); // float-dust safe (6.9999… rounds to 7 → 10)
  });
  it('guards non-positive / non-finite input', () => {
    expect(niceSnap(0)).toBe(0);
    expect(niceSnap(-5)).toBe(0);
    expect(niceSnap(NaN)).toBe(0);
  });
});

describe('gridScaleFor', () => {
  it('volatility mode: step = niceSnap(range x fraction), base snapped to nearest step', () => {
    // range 16 x 0.25 = 4 -> niceSnap -> 5; base = round(110/5)*5 = 110
    expect(gridScaleFor(110, 16, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 }))
      .toEqual({ base: 110, step: 5 });
  });
  it('volatility mode: no range available -> null (no grid that day)', () => {
    expect(gridScaleFor(110, null, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
    expect(gridScaleFor(110, 0, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
  });
  it('round mode: continuous magnitude, exact round levels', () => {
    // anchor 110 -> magnitude 100, roundBase 10, step 2, base = round(110/10)*10 = 110
    expect(gridScaleFor(110, null, { spacingMode: 'round', stepFraction: 0.25, roundBase: 0, stepSize: 0 }))
      .toEqual({ base: 110, step: 2 });
  });
  it('round mode: tiny price never collapses to base 0 (micro-cap safe)', () => {
    const s = gridScaleFor(0.0000123, null, { spacingMode: 'round', stepFraction: 0.25, roundBase: 0, stepSize: 0 })!;
    expect(s.base).toBeGreaterThan(0);
    expect(s.base - 4 * s.step).toBeGreaterThan(0); // deepest support still positive
  });
  it('manual mode: honors roundBase + stepSize', () => {
    // base = round(110/50)*50 = 100, step = 10
    expect(gridScaleFor(110, null, { spacingMode: 'manual', stepFraction: 0.25, roundBase: 50, stepSize: 10 }))
      .toEqual({ base: 100, step: 10 });
  });
  it('guards bad anchor / bad manual params', () => {
    expect(gridScaleFor(0, 16, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
    expect(gridScaleFor(110, null, { spacingMode: 'manual', stepFraction: 0.25, roundBase: 0, stepSize: 10 })).toBeNull();
  });
});
