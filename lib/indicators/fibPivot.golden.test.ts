import { describe, it, expect } from 'vitest';
import { computeFibPivot } from './fibPivot';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const DAY = 86400;

describe('fib_pivot golden master', () => {
  defineGoldenTest({ name: 'fibPivot', compute: computeFibPivot, params: { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 } });

  it('computes P/R/S from the prior daily range', () => {
    // day 0: high 110, low 90, close 100 -> P=100, range=20
    const candles: Candle[] = [
      { time: 0, open: 95, high: 110, low: 90, close: 100, volume: 1 },
      { time: DAY, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ];
    const res = computeFibPivot(candles, { id: 'fib_pivot', settings: { inputs: { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 }, styles: {}, visibility: {} } });
    const byTitle = Object.fromEntries((res.levels ?? []).map((l) => [l.title, l.value]));
    expect(byTitle.P).toBeCloseTo(100, 6);
    expect(byTitle.R1).toBeCloseTo(100 + 0.382 * 20, 6);
    expect(byTitle.S3).toBeCloseTo(100 - 1.0 * 20, 6);
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });

  it('emits no levels before the second period', () => {
    const oneDay: Candle[] = [{ time: 0, open: 95, high: 110, low: 90, close: 100, volume: 1 }];
    const res = computeFibPivot(oneDay, { id: 'fib_pivot', settings: { inputs: { period: 'D' }, styles: {}, visibility: {} } });
    expect(res.levels ?? []).toHaveLength(0);
  });
});
