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

describe('toRenko', () => {
  it('returns an empty array for empty input', () => {
    expect(toRenko([])).toEqual([]);
  });

  it('returns the initial anchor brick even with a single bar', () => {
    const out = toRenko(makeCandles([100]), { brickSize: 1 });
    expect(out.length).toBe(1);
    expect(out[0].close).toBe(100);
  });

  it('emits bricks with constant step size', () => {
    // A long run of +1 closes with brick=5 should produce a sequence
    // of bricks 5 units apart (rounded to brick boundaries).
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const bricks = toRenko(makeCandles(closes), { brickSize: 5 });
    expect(bricks.length).toBeGreaterThan(1);
    for (let i = 1; i < bricks.length; i++) {
      const diff = Math.abs(bricks[i].close - bricks[i - 1].close);
      expect(diff).toBe(5);
    }
  });

  it('emits strictly-increasing synthetic times', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + (i % 3 === 0 ? 3 : -2));
    const bricks = toRenko(makeCandles(closes), { brickSize: 2 });
    for (let i = 1; i < bricks.length; i++) {
      expect(bricks[i].time).toBeGreaterThan(bricks[i - 1].time);
    }
  });

  it('does not emit a brick for a small move inside one brick', () => {
    // Brick=10, move from 100 to 105 (5 units) → no new brick.
    const bricks = toRenko(makeCandles([100, 105]), { brickSize: 10 });
    // First brick (the anchor) only.
    expect(bricks.length).toBe(1);
  });

  it('emits multiple bricks from a single large bar', () => {
    // Brick=1, single bar goes 100 → 105 → 5 up-bricks + the anchor.
    const bricks = toRenko(makeCandles([100, 105]), { brickSize: 1 });
    expect(bricks.length).toBe(6); // 1 anchor + 5 up-bricks
    for (let i = 1; i < bricks.length; i++) {
      expect(bricks[i].close - bricks[i - 1].close).toBe(1);
    }
  });

  it('handles direction reversals correctly', () => {
    // 100 → 110 (2 up-bricks, brick=5), then 110 → 95 (3 down-bricks).
    const bricks = toRenko(makeCandles([100, 110, 95]), { brickSize: 5 });
    // Anchor at 100, then 105, 110, 105, 100, 95.
    expect(bricks.map((b) => b.close)).toEqual([100, 105, 110, 105, 100, 95]);
  });

  it('every brick has open === prior close (or anchor)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const bricks = toRenko(makeCandles(closes), { brickSize: 4 });
    for (let i = 1; i < bricks.length; i++) {
      expect(bricks[i].open).toBe(bricks[i - 1].close);
    }
  });

  it('falls back to 1% of the first close when no brick and no auto', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    // No options → 1% of 100 = 1. So bricks should step by 1.
    const bricks = toRenko(makeCandles(closes));
    expect(bricks.length).toBeGreaterThan(2);
    for (let i = 1; i < bricks.length; i++) {
      expect(Math.abs(bricks[i].close - bricks[i - 1].close)).toBe(1);
    }
  });

  it('auto-brick uses ATR when there are enough bars', () => {
    // 30 closes; ATR(14) will be defined at i=14.
    const closes = Array.from({ length: 30 }, (_, i) =>
      100 + Math.sin(i / 2) * 5,
    );
    const auto = toRenko(makeCandles(closes), { autoBrick: true });
    expect(auto.length).toBeGreaterThan(1);
  });
});
