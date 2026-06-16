import { describe, it, expect } from 'vitest';
import { buildSignalFlips } from './signalMarkers';
import type { Candle } from './types';

// Build candles from a close-price series; OHLC kept tight around close.
function candlesFrom(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 60,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 100,
  }));
}

describe('buildSignalFlips', () => {
  it('returns nothing without enough warm-up bars', () => {
    expect(buildSignalFlips(candlesFrom(Array.from({ length: 20 }, () => 100)))).toEqual([]);
  });

  it('emits a BUY in an uptrend and a SELL once it reverses', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i * 2); // rising
    const down = Array.from({ length: 60 }, (_, i) => 220 - i * 2); // falling
    const flips = buildSignalFlips(candlesFrom([...up, ...down]));
    expect(flips.length).toBeGreaterThanOrEqual(2);
    expect(flips.some((f) => f.side === 'buy')).toBe(true);
    expect(flips.some((f) => f.side === 'sell')).toBe(true);
    // First decisive flip in a clean uptrend is a buy.
    expect(flips[0].side).toBe('buy');
  });

  it('never emits the same side twice in a row (neutral gaps do not re-fire)', () => {
    const closes = [
      ...Array.from({ length: 50 }, (_, i) => 100 + i),
      ...Array.from({ length: 50 }, (_, i) => 150 - i),
      ...Array.from({ length: 50 }, (_, i) => 100 + i),
    ];
    const flips = buildSignalFlips(candlesFrom(closes));
    for (let i = 1; i < flips.length; i++) {
      expect(flips[i].side).not.toBe(flips[i - 1].side);
    }
  });

  it('places every flip at a real candle time', () => {
    const candles = candlesFrom(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 20));
    const times = new Set(candles.map((c) => c.time));
    for (const f of buildSignalFlips(candles)) {
      expect(times.has(f.time)).toBe(true);
    }
  });
});
