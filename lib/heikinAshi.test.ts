import { describe, it, expect } from 'vitest';
import { toHeikinAshi } from './heikinAshi';
import type { Candle } from './types';

const c = (time: number, o: number, h: number, l: number, cl: number): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: 0,
});

describe('toHeikinAshi', () => {
  it('returns [] for an empty input', () => {
    expect(toHeikinAshi([])).toEqual([]);
  });

  it('the first HA open is the average of O and C of the source bar', () => {
    const input = [c(1, 100, 110, 95, 105)];
    const out = toHeikinAshi(input);
    expect(out[0].open).toBeCloseTo((100 + 105) / 2, 10);
    expect(out[0].close).toBeCloseTo((100 + 110 + 95 + 105) / 4, 10);
  });

  it('HA high is the max of H, HA open, HA close; HA low is the min of L, HA open, HA close', () => {
    const input = [c(1, 100, 110, 90, 105), c(2, 106, 120, 95, 115)];
    const out = toHeikinAshi(input);
    const ha0 = out[0];
    const ha1 = out[1];
    expect(ha0.high).toBe(Math.max(110, ha0.open, ha0.close));
    expect(ha0.low).toBe(Math.min(90, ha0.open, ha0.close));
    expect(ha1.high).toBe(Math.max(120, ha1.open, ha1.close));
    expect(ha1.low).toBe(Math.min(95, ha1.open, ha1.close));
  });

  it('subsequent HA open is the mean of the previous HA open and close', () => {
    const input = [c(1, 100, 110, 90, 105), c(2, 106, 120, 95, 115), c(3, 116, 125, 110, 120)];
    const out = toHeikinAshi(input);
    const expectedOpen1 = (out[0].open + out[0].close) / 2;
    expect(out[1].open).toBeCloseTo(expectedOpen1, 10);
  });

  it('preserves bar timestamps', () => {
    const input = [c(100, 1, 2, 0.5, 1.5), c(200, 1.5, 2, 1, 1.8)];
    const out = toHeikinAshi(input);
    expect(out[0].time).toBe(100);
    expect(out[1].time).toBe(200);
  });
});
