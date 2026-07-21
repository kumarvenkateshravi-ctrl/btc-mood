import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { anchoredVwap } from './anchoredVwap';

// Two bars in the same UTC day (session): times 0 and 3600s.
const bars: Candle[] = [
  { time: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 },     // hlc3 = 10
  { time: 3600, open: 10, high: 22, low: 14, close: 18, volume: 300 }, // hlc3 = 18
];

describe('anchoredVwap', () => {
  it('cumulative volume-weighted mean + population sigma within a session', () => {
    // src = hlc3 = [10, 18].
    // bar 0: vwap = 10, variance 0 → sd 0.
    // bar 1: Σpv = 10·100 + 18·300 = 6400; Σv = 400 → vwap = 16.
    //   Σp²v = 100·100 + 324·300 = 107200; var = 107200/400 − 16² = 268 − 256 = 12; sd = √12.
    const { vwap, sd } = anchoredVwap(bars, [10, 18], 'session');
    expect(vwap[0]).toBe(10);
    expect(sd[0]).toBe(0);
    expect(vwap[1]).toBe(16);
    expect(sd[1]).toBeCloseTo(Math.sqrt(12), 10);
  });

  it('re-anchors (resets sums) when the period key changes', () => {
    // Second bar one day later → new session → vwap resets to that bar alone.
    const twoDays: Candle[] = [
      { time: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { time: 90_000, open: 20, high: 22, low: 18, close: 20, volume: 50 }, // next UTC day, hlc3 = 20
    ];
    const { vwap, sd } = anchoredVwap(twoDays, [10, 20], 'session');
    expect(vwap[1]).toBe(20);
    expect(sd[1]).toBe(0);
  });
});
