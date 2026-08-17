import { describe, it, expect } from 'vitest';
import {
  accumulateTrade,
  emptyDailyFlow,
  flowStats,
  resetDailyFlow,
  seedFromCandles,
  sparkSeries,
  utcDay,
} from './dailyOrderFlow';
import type { Candle } from './types';
import type { Trade } from './ws';

const DAY = 86_400;
/** 2024-01-02T00:00:00Z — an exact UTC midnight, so day maths is unambiguous. */
const MIDNIGHT = Date.UTC(2024, 0, 2) / 1000;

let tradeId = 0;
function trade(side: 'buy' | 'sell', qty: number, time: number): Trade {
  return { id: tradeId++, price: 100, qty, side, time };
}

function candle(time: number, volume: number, takerBuyVolume?: number): Candle {
  return { time, open: 100, high: 101, low: 99, close: 100, volume, takerBuyVolume };
}

describe('utcDay', () => {
  it('groups by UTC calendar day', () => {
    expect(utcDay(MIDNIGHT)).toBe(utcDay(MIDNIGHT + 23 * 3600));
    expect(utcDay(MIDNIGHT + DAY)).toBe(utcDay(MIDNIGHT) + 1);
  });
});

describe('accumulateTrade', () => {
  it('splits volume by aggressor side', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 3, MIDNIGHT + 60));
    accumulateTrade(acc, trade('sell', 2, MIDNIGHT + 120));
    expect(acc.buyVol).toBe(3);
    expect(acc.sellVol).toBe(2);
  });

  it('resets when the UTC day rolls over', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 10, MIDNIGHT + 23 * 3600));
    expect(acc.buyVol).toBe(10);

    accumulateTrade(acc, trade('buy', 1, MIDNIGHT + DAY + 60)); // next day
    expect(acc.buyVol).toBe(1);
    expect(acc.sellVol).toBe(0);
    expect(acc.day).toBe(utcDay(MIDNIGHT) + 1);
  });

  it('keeps accumulating within the same day', () => {
    const acc = emptyDailyFlow();
    for (let i = 0; i < 5; i++) {
      accumulateTrade(acc, trade('buy', 1, MIDNIGHT + i * 3600));
    }
    expect(acc.buyVol).toBe(5);
  });
});

describe('seedFromCandles', () => {
  it('derives buy and sell volume from taker-buy volume', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [
      candle(MIDNIGHT + 60, 100, 70), // 70 buy / 30 sell
      candle(MIDNIGHT + 120, 50, 20), // 20 buy / 30 sell
    ]);
    expect(acc.buyVol).toBe(90);
    expect(acc.sellVol).toBe(60);
  });

  it('ignores candles from other days', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [
      candle(MIDNIGHT - DAY + 60, 999, 999), // yesterday
      candle(MIDNIGHT + 60, 100, 70),
    ]);
    expect(acc.buyVol).toBe(70);
    expect(acc.sellVol).toBe(30);
  });

  it('skips candles with no taker-buy volume rather than guessing', () => {
    // Inferring side from close-vs-open would fabricate order flow.
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [candle(MIDNIGHT + 60, 100, undefined)]);
    expect(acc.buyVol).toBe(0);
    expect(acc.sellVol).toBe(0);
  });

  it('clamps a taker-buy volume that exceeds total volume', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [candle(MIDNIGHT + 60, 100, 140)]);
    expect(acc.buyVol).toBe(100);
    expect(acc.sellVol).toBe(0);
  });

  it('sets a watermark at the last seeded candle', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [
      candle(MIDNIGHT + 60, 10, 5),
      candle(MIDNIGHT + 300, 10, 5),
    ]);
    expect(acc.watermark).toBe(MIDNIGHT + 300);
  });
});

describe('backfill → live handover', () => {
  it('ignores trades already covered by the backfill', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [candle(MIDNIGHT + 300, 100, 70)]);
    const before = acc.buyVol;

    // A trade at/behind the watermark is inside a counted kline.
    accumulateTrade(acc, trade('buy', 50, MIDNIGHT + 200));
    accumulateTrade(acc, trade('buy', 50, MIDNIGHT + 300));
    expect(acc.buyVol).toBe(before);
  });

  it('counts trades after the watermark', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [candle(MIDNIGHT + 300, 100, 70)]);
    accumulateTrade(acc, trade('buy', 5, MIDNIGHT + 301));
    expect(acc.buyVol).toBe(75);
  });

  it('still rolls the day even if the new day starts behind the watermark', () => {
    const acc = emptyDailyFlow();
    seedFromCandles(acc, [candle(MIDNIGHT + 23 * 3600, 100, 70)]);
    accumulateTrade(acc, trade('sell', 4, MIDNIGHT + DAY + 60));
    expect(acc.day).toBe(utcDay(MIDNIGHT) + 1);
    expect(acc.sellVol).toBe(4);
    expect(acc.buyVol).toBe(0);
  });
});

describe('flowStats', () => {
  it('reports no data for an empty accumulator', () => {
    const s = flowStats(emptyDailyFlow());
    expect(s.hasData).toBe(false);
    expect(s.dominant).toBe('balanced');
    expect(Number.isNaN(s.buyShare)).toBe(false);
  });

  it('calls the dominant side and computes delta', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 70, MIDNIGHT + 60));
    accumulateTrade(acc, trade('sell', 30, MIDNIGHT + 61));
    const s = flowStats(acc);
    expect(s.delta).toBe(40);
    expect(s.buyShare).toBeCloseTo(0.7, 6);
    expect(s.dominant).toBe('buyers');
    expect(s.imbalance).toBeCloseTo(0.4, 6);
  });

  it('calls a near-even tape balanced', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 100, MIDNIGHT + 60));
    accumulateTrade(acc, trade('sell', 99, MIDNIGHT + 61));
    expect(flowStats(acc).dominant).toBe('balanced');
  });

  it('flips to sellers when sell volume leads', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 20, MIDNIGHT + 60));
    accumulateTrade(acc, trade('sell', 80, MIDNIGHT + 61));
    const s = flowStats(acc);
    expect(s.dominant).toBe('sellers');
    expect(s.delta).toBe(-60);
  });
});

describe('sparkSeries', () => {
  it('is empty before any data', () => {
    expect(sparkSeries(emptyDailyFlow())).toEqual([]);
  });

  it('tracks cumulative delta over the day', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 10, MIDNIGHT + 60));       // bucket 0
    accumulateTrade(acc, trade('sell', 4, MIDNIGHT + 20 * 60));  // bucket 4
    const s = sparkSeries(acc);
    expect(s[0]).toBe(10);
    expect(s[s.length - 1]).toBe(6);
  });

  it('stops at the last traded bucket instead of padding the rest of the day', () => {
    // Early-morning trades must not be drawn as a whole completed day.
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 10, MIDNIGHT + 60));      // bucket 0
    accumulateTrade(acc, trade('buy', 5, MIDNIGHT + 20 * 60));  // bucket 4
    expect(sparkSeries(acc)).toEqual([10, 10, 10, 10, 15]);
  });

  it('keeps a flat day rather than trimming it to nothing', () => {
    // Every bucket carries the same cumulative delta; none of it is a tail.
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 7, MIDNIGHT + 60));       // bucket 0
    accumulateTrade(acc, trade('buy', 0, MIDNIGHT + 20 * 60));  // bucket 4, delta unchanged
    expect(sparkSeries(acc)).toEqual([7, 7, 7, 7, 7]);
  });

  it('is monotonic in length as the day fills', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 1, MIDNIGHT + 60));
    const a = sparkSeries(acc).length;
    accumulateTrade(acc, trade('buy', 1, MIDNIGHT + 3600));
    expect(sparkSeries(acc).length).toBeGreaterThanOrEqual(a);
  });
});

describe('resetDailyFlow', () => {
  it('clears everything for a symbol switch', () => {
    const acc = emptyDailyFlow();
    accumulateTrade(acc, trade('buy', 10, MIDNIGHT + 60));
    resetDailyFlow(acc);
    expect(acc.day).toBeNull();
    expect(acc.buyVol).toBe(0);
    expect(acc.watermark).toBe(0);
    expect(sparkSeries(acc)).toEqual([]);
  });
});
