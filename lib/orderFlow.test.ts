import { describe, it, expect } from 'vitest';
import { emptyDelta, candleBucket, accumulate, delta } from './orderFlow';
import type { Trade } from './ws';

const trade = (over: Partial<Trade>): Trade => ({
  id: 1,
  price: 100,
  qty: 1,
  side: 'buy',
  time: 1_700_000_000,
  ...over,
});

describe('candleBucket', () => {
  it('buckets by timeframe seconds', () => {
    expect(candleBucket(900, '15m')).toBe(1); // 900 / 900
    expect(candleBucket(899, '15m')).toBe(0);
    expect(candleBucket(3600, '1h')).toBe(1);
  });
});

describe('accumulate / delta', () => {
  it('sums buy and sell volume within a candle', () => {
    const acc = emptyDelta();
    accumulate(acc, trade({ side: 'buy', qty: 2, time: 1000 }), '15m');
    accumulate(acc, trade({ side: 'sell', qty: 0.5, time: 1001 }), '15m');
    expect(acc.buyVol).toBe(2);
    expect(acc.sellVol).toBe(0.5);
    expect(delta(acc)).toBeCloseTo(1.5, 9);
  });

  it('resets when crossing into a new candle', () => {
    const acc = emptyDelta();
    accumulate(acc, trade({ side: 'buy', qty: 5, time: 800 }), '15m'); // bucket 0
    expect(delta(acc)).toBe(5);
    accumulate(acc, trade({ side: 'sell', qty: 1, time: 901 }), '15m'); // bucket 1 → reset
    expect(acc.buyVol).toBe(0);
    expect(acc.sellVol).toBe(1);
    expect(delta(acc)).toBe(-1);
  });
});
