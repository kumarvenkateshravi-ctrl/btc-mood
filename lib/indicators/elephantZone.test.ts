import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeElephantZone, niceSnap, gridScaleFor } from './elephantZone';

const DAY = 86400;
const bar = (time: number, close: number): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });

describe('computeElephantZone', () => {
  it('first day in history has no previous-day anchor → all zones null', () => {
    const candles = [bar(0, 100), bar(100, 101), bar(200, 102)];
    const { plots } = computeElephantZone(candles);
    expect(plots).toHaveLength(10);
    for (const p of plots) expect(p.data.every((d) => d === null)).toBe(true);
  });

  it('anchors day 1 on day 0s last close, and the zone persists for every bar of day 1', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),          // day 0, last close = 110
      bar(DAY, 200), bar(DAY + 100, 201), bar(DAY + 200, 202), // day 1
    ];
    const { plots } = computeElephantZone(candles);
    const r1 = plots.find((p) => p.id === 'R1')!;
    expect(r1.data[0]).toBeNull();
    expect(r1.data[1]).toBeNull();
    // day 1: anchor = 110 (day 0's last close), R1 center = 110+15=125, width 6 -> [122,128]
    expect(r1.data[2]).toEqual({ upper: 128, lower: 122 });
    expect(r1.data[3]).toEqual({ upper: 128, lower: 122 });
    expect(r1.data[4]).toEqual({ upper: 128, lower: 122 });

    const s1 = plots.find((p) => p.id === 'S1')!;
    // S1 center = 110-15=95 -> [92,98]
    expect(s1.data[2]).toEqual({ upper: 98, lower: 92 });
  });

  it('resets to a new anchor on the next UTC day boundary', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),   // day0, close 110
      bar(DAY, 200), bar(DAY + 100, 220), // day1, close 220
      bar(2 * DAY, 300),                   // day2
    ];
    const { plots } = computeElephantZone(candles);
    const r1 = plots.find((p) => p.id === 'R1')!;
    expect(r1.data[2]).toEqual({ upper: 128, lower: 122 }); // day1 anchor=110 -> center 125
    expect(r1.data[4]).toEqual({ upper: 238, lower: 232 }); // day2 anchor=220 -> center 235
  });

  it('a session gap (e.g. NIFTY: no candles between prior close and next open) still anchors on the last candle before the boundary', () => {
    const candles = [
      bar(DAY - 3600 * 6, 500), // day0, 6h before the UTC boundary (e.g. 3:30pm IST close)
      bar(DAY + 3600 * 4, 505), // day1, 4h after the boundary (e.g. 9:15am IST open) — big gap
    ];
    const { plots } = computeElephantZone(candles);
    const r1 = plots.find((p) => p.id === 'R1')!;
    expect(r1.data[0]).toBeNull();
    expect(r1.data[1]).toEqual({ upper: 518, lower: 512 }); // anchor=500 -> center 515
  });

  it('empty candles → no plots, no throw', () => {
    expect(() => computeElephantZone([])).not.toThrow();
    expect(computeElephantZone([]).plots).toEqual([]);
  });

  it('produces 8 zone bands + 2 pivot lines (PIVOT, PIVOT_P), all on the overlay pane', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const { plots } = computeElephantZone(candles);
    expect(plots.map((p) => p.id).sort()).toEqual(['PIVOT', 'PIVOT_P', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']);
    const zones = plots.filter((p) => p.id !== 'PIVOT' && p.id !== 'PIVOT_P');
    expect(zones.every((p) => p.type === 'band')).toBe(true);
    expect(plots.find((p) => p.id === 'PIVOT')!.type).toBe('line');
    expect(plots.find((p) => p.id === 'PIVOT_P')!.type).toBe('line');
    expect(plots.every((p) => p.pane === 'overlay')).toBe(true);
  });

  it('pivot line carries the day anchor (previous day close) per bar, null on the first day', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),          // day 0, last close = 110
      bar(DAY, 200), bar(DAY + 100, 201),        // day 1
    ];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    expect(pivot.data[0]).toBeNull(); // day 0: no prior close
    expect(pivot.data[1]).toBeNull();
    expect(pivot.data[2]).toBe(110); // day 1 anchor = day 0 close
    expect(pivot.data[3]).toBe(110);
  });

  it('pivot resets to the new anchor at the next UTC boundary', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),   // day0 close 110
      bar(DAY, 200), bar(DAY + 100, 220), // day1 close 220
      bar(2 * DAY, 300),                   // day2
    ];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    expect(pivot.data[2]).toBe(110); // day1 anchor
    expect(pivot.data[4]).toBe(220); // day2 anchor
  });

  it('pivot is a solid 3px line that scales in pixels (never collapses when the chart shrinks)', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    expect(pivot.type).toBe('line');
    expect(pivot.lineWidth).toBe(3);
    expect(pivot.zoneStyle).toBeUndefined();
  });

  it('classic pivot P = (H+L+C)/3 of the PREVIOUS day, aggregated across ALL its bars (not just the last)', () => {
    // bar(t,c): high=c+1, low=c-1. Day 0 bars close 100 then 112:
    //   day-0 aggregate → high 113 (from 112), low 99 (from 100), close 112 (last)
    //   P = (113 + 99 + 112) / 3 = 108  (last-bar-only would wrongly give 112)
    const candles = [
      bar(0, 100), bar(DAY - 100, 112),          // day 0
      bar(DAY, 200), bar(DAY + 100, 201),        // day 1
    ];
    const pp = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT_P')!;
    expect(pp.data[0]).toBeNull(); // day 0: no prior day
    expect(pp.data[1]).toBeNull();
    expect(pp.data[2]).toBe(108);
    expect(pp.data[3]).toBe(108);
    expect(pp.type).toBe('line');
    expect(pp.lineWidth).toBe(3);
  });

  it('classic pivot P resets from each new prior-day aggregate at the UTC boundary', () => {
    // day1 bars close 200 then 218 → high 219, low 199, close 218 → P = (219+199+218)/3 = 212
    const candles = [
      bar(0, 100), bar(DAY - 100, 112),   // day0 → P(day1) = 108
      bar(DAY, 200), bar(DAY + 100, 218), // day1 → P(day2) = 212
      bar(2 * DAY, 300),                   // day2
    ];
    const pp = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT_P')!;
    expect(pp.data[2]).toBe(108); // day1 pivot from day0 aggregate
    expect(pp.data[4]).toBe(212); // day2 pivot from day1 aggregate
  });

  it('zones carry a boundary + name label so they render bordered and named (not a faint fill)', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const plots = computeElephantZone(candles).plots;
    const r1 = plots.find((p) => p.id === 'R1')!;
    const s1 = plots.find((p) => p.id === 'S1')!;
    // Resistance is approached from below → boundary 'lower'; support → 'upper'.
    expect(r1.zoneStyle).toEqual({ boundary: 'lower', lineStyle: 'solid', label: 'R1', emphasis: 0 });
    expect(s1.zoneStyle).toEqual({ boundary: 'upper', lineStyle: 'solid', label: 'S1', emphasis: 0 });
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
