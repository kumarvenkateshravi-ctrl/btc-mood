import { describe, expect, it } from 'vitest';
import { toRenko } from './renko';
import type { Candle } from './types';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 60,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

/** Completed bricks = everything except the trailing forming (ghost) brick. */
const completed = (bricks: Candle[]) => bricks.slice(0, -1);
const forming = (bricks: Candle[]) => bricks[bricks.length - 1];

describe('toRenko (TradingView-style: grid anchor, real timestamps, forming brick)', () => {
  it('returns an empty array for empty input', () => {
    expect(toRenko([])).toEqual([]);
  });

  it('single bar → grid anchor + forming brick at the live close', () => {
    const out = toRenko(makeCandles([100]), { brickSize: 1 });
    expect(out.length).toBe(2);
    expect(out[0].close).toBe(100); // anchor (100 is already on the grid)
    expect(forming(out).close).toBe(100);
    // anchor sits 1s before the candle so times stay strictly increasing
    expect(out[0].time).toBe(1_700_000_000 - 1);
    expect(forming(out).time).toBe(1_700_000_000);
  });

  it('snaps the anchor DOWN to the brick grid (Traditional Renko)', () => {
    const out = toRenko(makeCandles([103.7, 103.9]), { brickSize: 5 });
    expect(out[0].close).toBe(100); // floor(103.7 / 5) * 5
  });

  it('completed bricks step by exactly one brick; the forming brick is partial', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const bricks = toRenko(makeCandles(closes), { brickSize: 5 });
    const done = completed(bricks);
    expect(done.length).toBeGreaterThan(1);
    for (let i = 1; i < done.length; i++) {
      expect(Math.abs(done[i].close - done[i - 1].close)).toBe(5);
    }
    // forming brick always ends at the last candle's close
    expect(forming(bricks).close).toBe(closes[closes.length - 1]);
  });

  it('emits strictly-increasing times', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + (i % 3 === 0 ? 3 : -2));
    const bricks = toRenko(makeCandles(closes), { brickSize: 2 });
    for (let i = 1; i < bricks.length; i++) {
      expect(bricks[i].time).toBeGreaterThan(bricks[i - 1].time);
    }
  });

  it('a move inside one brick completes nothing — anchor + forming only', () => {
    const bricks = toRenko(makeCandles([100, 105]), { brickSize: 10 });
    expect(bricks.length).toBe(2);
    expect(forming(bricks).close).toBe(105); // the partial move is visible
  });

  it('emits multiple bricks from a single large bar, spread within its time slot', () => {
    // brick=1, one bar goes 100 → 105: 5 completed up-bricks + anchor + forming.
    const bricks = toRenko(makeCandles([100, 105]), { brickSize: 1 });
    expect(bricks.length).toBe(7);
    const done = completed(bricks);
    for (let i = 2; i < done.length; i++) {
      expect(done[i].close - done[i - 1].close).toBe(1);
    }
    // the last completed brick from the candle lands AT the candle's time…
    expect(done[done.length - 1].time).toBe(1_700_000_060);
    // …and every brick stays within the candle's slot (prev time, candle time]
    for (const b of done.slice(1)) {
      expect(b.time).toBeGreaterThan(1_700_000_000 - 1);
      expect(b.time).toBeLessThanOrEqual(1_700_000_060);
    }
  });

  it('handles direction reversals correctly', () => {
    // 100 → 110 (2 up-bricks, brick=5), then 110 → 95 (3 down-bricks),
    // then the zero-width forming brick at 95.
    const bricks = toRenko(makeCandles([100, 110, 95]), { brickSize: 5 });
    expect(bricks.map((b) => b.close)).toEqual([100, 105, 110, 105, 100, 95, 95]);
  });

  it('every completed brick opens at the prior close', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const bricks = toRenko(makeCandles(closes), { brickSize: 4 });
    const done = completed(bricks);
    for (let i = 1; i < done.length; i++) {
      expect(done[i].open).toBe(done[i - 1].close);
    }
    // the forming brick continues from the last completed grid level
    expect(forming(bricks).open).toBe(done[done.length - 1].close);
  });

  it('drops malformed bars instead of poisoning the whole series', () => {
    const candles = makeCandles([100, 102, 104, 106]);
    candles[1] = { ...candles[1], close: Number.NaN, open: Number.NaN };
    const bricks = toRenko(candles, { brickSize: 1 });
    expect(bricks.length).toBeGreaterThan(1);
    for (const b of bricks) {
      expect(Number.isFinite(b.open)).toBe(true);
      expect(Number.isFinite(b.close)).toBe(true);
      expect(Number.isFinite(b.time as number)).toBe(true);
    }
    expect(forming(bricks).close).toBe(106);
  });

  it('falls back to 1% of the first close when no brick and no auto', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bricks = toRenko(makeCandles(closes));
    const done = completed(bricks);
    expect(done.length).toBeGreaterThan(2);
    for (let i = 1; i < done.length; i++) {
      expect(Math.abs(done[i].close - done[i - 1].close)).toBe(1); // 1% of 100
    }
  });

  it('auto-brick uses ATR when there are enough bars', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 5);
    const auto = toRenko(makeCandles(closes), { autoBrick: true });
    expect(auto.length).toBeGreaterThan(1);
  });

  describe('box-size methods', () => {
    it('traditional method uses brickSize as the fixed step', () => {
      const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
      const bricks = toRenko(makeCandles(closes), { method: 'traditional', brickSize: 5 });
      const done = completed(bricks);
      expect(done.length).toBeGreaterThan(1);
      for (let i = 1; i < done.length; i++) {
        expect(Math.abs(done[i].close - done[i - 1].close)).toBe(5);
      }
    });

    it('traditional method falls back to 1% when brickSize is missing', () => {
      const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
      const bricks = toRenko(makeCandles(closes), { method: 'traditional' });
      const done = completed(bricks);
      for (let i = 1; i < done.length; i++) {
        expect(Math.abs(done[i].close - done[i - 1].close)).toBe(1);
      }
    });

    it('atr method honors a custom atrLength and produces bricks', () => {
      const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 6);
      const a14 = toRenko(makeCandles(closes), { method: 'atr', atrLength: 14 });
      const a5 = toRenko(makeCandles(closes), { method: 'atr', atrLength: 5 });
      expect(a14.length).toBeGreaterThan(1);
      expect(a5.length).toBeGreaterThan(1);
    });

    it('percentage method steps by percentage of the last traded price', () => {
      // Last close = 100; 5% → box size 5.
      const closes = Array.from({ length: 60 }, (_, i) => 80 + i * (20 / 59));
      const bricks = toRenko(makeCandles(closes), { method: 'percentage', percentage: 5 });
      const done = completed(bricks);
      const expectedBox = closes[closes.length - 1] * 0.05;
      expect(done.length).toBeGreaterThan(1);
      for (let i = 1; i < done.length; i++) {
        expect(Math.abs(done[i].close - done[i - 1].close)).toBeCloseTo(expectedBox, 6);
      }
    });
  });
});
