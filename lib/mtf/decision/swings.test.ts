import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { findSwings, lastConfirmedSwings } from './swings';

// Constant-range bars: high = mid+1, low = mid−1, close = mid.
const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));

const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];
const RRLOW = [100, 101, 102, 101, 100, 99, 100, 101, 100.5, 100, 100.5, 101, 101, 101, 101, 101, 101, 101, 101, 101];

describe('fractal swings (k=2, strict, confirmed only)', () => {
  it('finds the single swing high/low pair in the canonical long fixture', () => {
    const { swingHigh, swingLow } = lastConfirmedSwings(bars(LONG));
    expect(swingHigh).toEqual({ index: 10, price: 111 });
    expect(swingLow).toEqual({ index: 14, price: 105 });
  });

  it('returns the MOST RECENT confirmed swings when several exist', () => {
    const { highs, lows } = findSwings(bars(RRLOW));
    expect(highs.map((s) => s.price)).toEqual([103, 102]); // bars 2, 7
    expect(lows.map((s) => s.price)).toEqual([98, 99]);    // bars 5, 9
    const last = lastConfirmedSwings(bars(RRLOW));
    expect(last.swingHigh).toEqual({ index: 7, price: 102 });
    expect(last.swingLow).toEqual({ index: 9, price: 99 });
  });

  it('monotone series has no confirmed swings; last k bars never confirm', () => {
    const mono = bars(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(lastConfirmedSwings(mono)).toEqual({ swingHigh: null, swingLow: null });
  });

  it('ties are not swings (strict comparison)', () => {
    const flat = bars([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(lastConfirmedSwings(flat)).toEqual({ swingHigh: null, swingLow: null });
  });
});
