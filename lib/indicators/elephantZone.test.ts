import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeElephantZone } from './elephantZone';

const DAY = 86400;
const bar = (time: number, close: number): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });

describe('computeElephantZone', () => {
  it('first day in history has no previous-day anchor → all zones null', () => {
    const candles = [bar(0, 100), bar(100, 101), bar(200, 102)];
    const { plots } = computeElephantZone(candles);
    expect(plots).toHaveLength(8);
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

  it('produces exactly 8 band plots (R1-4, S1-4) with the default config', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const { plots } = computeElephantZone(candles);
    expect(plots.map((p) => p.id).sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']);
    expect(plots.every((p) => p.type === 'band' && p.pane === 'overlay')).toBe(true);
  });
});
