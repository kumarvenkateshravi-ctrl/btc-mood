import { describe, it, expect } from 'vitest';
import { computeVolatility } from './volatility';
import type { Candle } from '@/lib/types';

const bar = (h: number, l: number, c: number, o = c): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: c, volume: 1 });

describe('computeVolatility', () => {
  it('marks a bar as high-volatility when range >= 2x measure and swaps parsed H/L', () => {
    // 30 calm bars (range 1) then one spike bar (range 10)
    const candles: Candle[] = [
      ...Array.from({ length: 30 }, () => bar(101, 100, 100.5)),
      bar(110, 100, 105),
    ];
    candles.forEach((c, i) => (c.time = i * 60));
    const v = computeVolatility(candles, 'atr');
    const last = candles.length - 1;
    expect(v.isHighVolatility[last]).toBe(true);
    expect(v.parsedHighs[last]).toBe(100); // swapped: low
    expect(v.parsedLows[last]).toBe(110); // swapped: high
    expect(v.isHighVolatility[5]).toBe(false);
    expect(v.parsedHighs[5]).toBe(101);
    expect(v.parsedLows[5]).toBe(100);
  });

  it('range filter uses cumulative mean true range', () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({ ...bar(101, 100, 100.5), time: i * 60 }));
    const v = computeVolatility(candles, 'range');
    // Pine formula is ta.cum(ta.tr)/bar_index: at bar_index 9 the cumulative
    // sum holds 10 TRs of 1 => 10/9 (the script's own off-by-one, kept faithful).
    expect(v.measure[9]).toBeCloseTo(10 / 9, 6);
  });

  it('handles empty input', () => {
    const v = computeVolatility([], 'atr');
    expect(v.parsedHighs).toEqual([]);
    expect(v.atr200).toEqual([]);
  });
});
