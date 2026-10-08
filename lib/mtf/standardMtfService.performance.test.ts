import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../types';
import { buildStandardMtfSnapshot } from './standardMtfService';

function candles(seed: number): Candle[] {
  return Array.from({ length: 721 }, (_, index) => {
    const open = 40_000 + seed + index * 4 + Math.sin(index / 6) * 30;
    const close = open + Math.cos(index / 4) * 8;
    return { time: 1_700_000_000 + index * 300, open, high: Math.max(open, close) + 10, low: Math.min(open, close) - 10, close, volume: 1_000 + (index % 17) * 80, takerBuyVolume: 500 + (index % 13) * 30 };
  });
}

describe('Phase 5 Standard MTF snapshot performance', () => {
  it('builds a full closed-bar snapshot with all category intelligence in a bounded time', () => {
    const source = Object.fromEntries(['5m', '15m', '30m', '1h', '4h', '1d'].map((timeframe, index) => [timeframe, candles(index * 10)])) as Record<Timeframe, Candle[]>;
    const start = performance.now();
    const result = buildStandardMtfSnapshot({ symbol: 'BTCUSDT', candlesByTimeframe: source });
    const elapsed = performance.now() - start;
    expect(result.snapshot.categories.marketStructure.availability).toBe('available');
    expect(result.snapshot.categories.volumeProfile.availability).toBe('available');
    // A generous guard detects algorithmic regressions while allowing CI noise.
    expect(elapsed).toBeLessThan(2_000);
  });
});
