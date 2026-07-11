import { describe, it, expect } from 'vitest';
import { createSwingTracker } from './swings';
import type { Candle } from '@/lib/types';

/** Triangle wave: rises to 110 at i=10, falls to 90 at i=30, rises to 120 at i=60. */
function triangle(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i <= 10; i++) closes.push(100 + i); // 100..110
  for (let i = 1; i <= 20; i++) closes.push(110 - i); // ..90
  for (let i = 1; i <= 30; i++) closes.push(90 + i); // ..120
  return closes.map((c, i) => ({ time: i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
}

describe('createSwingTracker', () => {
  it('detects the 110 swing high and 90 swing low with size 5', () => {
    const candles = triangle();
    const tracker = createSwingTracker(candles, 5);
    const updates = [];
    for (let i = 0; i < candles.length; i++) {
      const u = tracker.onBar(i);
      if (u) updates.push(u);
    }
    const high = updates.find((u) => u.kind === 'high');
    // Pine's leg starts bearish, so an initial pivot low fires at bar 0 when
    // the first bullish leg is confirmed — the trough is the LAST low pivot.
    const low = updates.filter((u) => u.kind === 'low').at(-1);
    expect(high).toBeDefined();
    expect(high!.level).toBeCloseTo(110.5); // high of the i=10 bar
    expect(high!.barIndex).toBe(10);
    expect(high!.barTime).toBe(10 * 60);
    expect(low).toBeDefined();
    expect(low!.level).toBeCloseTo(89.5); // low of the i=30 bar
    expect(low!.barIndex).toBe(30);
    expect(low!.label).toBe('LL');
    // pivot state reflects the latest pivots
    expect(tracker.high.currentLevel).toBeCloseTo(110.5);
    expect(tracker.low.currentLevel).toBeCloseTo(89.5);
    expect(tracker.high.crossed).toBe(false);
  });

  it('labels a higher high as HH', () => {
    // two peaks: 110 then 115
    const closes: number[] = [];
    for (let i = 0; i <= 10; i++) closes.push(100 + i); // →110
    for (let i = 1; i <= 10; i++) closes.push(110 - i); // →100
    for (let i = 1; i <= 15; i++) closes.push(100 + i); // →115
    for (let i = 1; i <= 10; i++) closes.push(115 - i); // →105
    const candles: Candle[] = closes.map((c, i) => ({ time: i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
    const tracker = createSwingTracker(candles, 5);
    const highs = [];
    for (let i = 0; i < candles.length; i++) {
      const u = tracker.onBar(i);
      if (u?.kind === 'high') highs.push(u);
    }
    expect(highs.length).toBe(2);
    expect(highs[1].label).toBe('HH');
    expect(tracker.high.lastLevel).toBeCloseTo(110.5);
  });
});
