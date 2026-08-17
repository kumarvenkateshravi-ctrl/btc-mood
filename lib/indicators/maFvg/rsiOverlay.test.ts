import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeRsi } from '../rsi';
import { rawRsi, scaleToPrice, crossSignals, emitCrossSignals, confidenceBand, CONFIDENCE_FULL_SEP_OSC } from './rsiOverlay';

describe('rawRsi', () => {
  it('matches the golden-tested computeRsi engine (parity)', () => {
    const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const candles: Candle[] = closes.map((c, i) => ({ time: i * 60, open: c, high: c, low: c, close: c, volume: 1 }));
    const engine = computeRsi(candles, { length: 14 } as never).plots.find((p) => p.id === 'rsi')!.data as (number | null)[];
    const mine = rawRsi(closes, 14);
    for (let i = 0; i < closes.length; i++) {
      if (engine[i] == null) expect(mine[i]).toBeNull();
      else expect(mine[i]!).toBeCloseTo(engine[i] as number, 8);
    }
  });

  it('is 100 on a strictly rising series and 0 on a strictly falling one', () => {
    const up = rawRsi([1, 2, 3, 4, 5, 6], 2);
    const down = rawRsi([6, 5, 4, 3, 2, 1], 2);
    expect(up.at(-1)).toBe(100);
    expect(down.at(-1)).toBe(0);
  });
});

describe('scaleToPrice', () => {
  it('maps 50 to the baseline and ±50 to ±half the price range', () => {
    // baseline 100, range 40: scale(v) = 100 + (v-50)/100*40.
    expect(scaleToPrice(50, 100, 40)).toBe(100);
    expect(scaleToPrice(100, 100, 40)).toBe(120);
    expect(scaleToPrice(0, 100, 40)).toBe(80);
  });
});

describe('crossSignals', () => {
  it('fires buy when strength rises above BOTH vwap and ma4; sell when below both', () => {
    // strength vs vwap(=10 const) and ma4(=12 const):
    // i0: 9  (below both)  i1: 13 (above both → buy)  i2: 14 (still above, no repeat)
    // i3: 8  (below both → sell)
    const { buy, sell } = crossSignals([9, 13, 14, 8], [10, 10, 10, 10], [12, 12, 12, 12]);
    expect(buy).toEqual([false, true, false, false]);
    expect(sell).toEqual([false, false, false, true]);
  });

  it('does not fire when only one condition is met', () => {
    // strength 11 is above vwap(10) but below ma4(12) → neither above-both nor below-both.
    const { buy, sell } = crossSignals([9, 11], [10, 10], [12, 12]);
    expect(buy).toEqual([false, false]);
    expect(sell).toEqual([false, false]);
  });
});

describe('emitCrossSignals (cooldown / trend filter / confidence)', () => {
  const V = [10, 10, 10, 10, 10, 10];
  const M = [12, 12, 12, 12, 12, 12];
  const closes = [100, 100, 100, 100, 100, 100];

  it('fires a BUY on the fresh cross above both, confidence in RSI oscillator space', () => {
    // strength 9 (below) → 15 (above both). BUY at i=1. gap = min(15-10,15-12) = 3.
    // normalizer 30 → sepOsc = 3/30*100 = 10 → confidence = round(10/20*100) = 50.
    const norm = [null, 30, 30, 30, 30, 30];
    expect(emitCrossSignals([9, 15, 15, 15, 15, 15], V, M, closes, { normalizer: norm }))
      .toEqual([{ index: 1, side: 'buy', confidence: 50 }]);
    // A wider gap (11 → sepOsc 36.67 → 183 capped) saturates at 100.
    expect(emitCrossSignals([9, 23, 23, 23, 23, 23], V, M, closes, { normalizer: norm })[0].confidence).toBe(100);
    // No normalizer → separation can't be measured → 0 (not a fake price %).
    expect(emitCrossSignals([9, 15, 15, 15, 15, 15], V, M, closes)[0].confidence).toBe(0);
  });

  it('null-guards warm-up (no coercion signals) and never fires on bar 0', () => {
    const ev = emitCrossSignals([null, 15, 15], V, M, closes);
    expect(ev).toEqual([]); // i=1 needs a valid i-1; bar 0 is null → skipped.
  });

  it('cooldown collapses a cluster of signals into the first', () => {
    // s dips below/above both repeatedly → buy@1, sell@2, buy@3 with no cooldown.
    const s = [9, 15, 9, 15, 15, 15];
    expect(emitCrossSignals(s, V, M, closes, { cooldownBars: 0 }).map((e) => e.index)).toEqual([1, 2, 3]);
    // cooldown 3: after firing at 1, bars 2 and 3 are within 3 → suppressed.
    expect(emitCrossSignals(s, V, M, closes, { cooldownBars: 3 }).map((e) => e.index)).toEqual([1]);
  });

  it('trend filter blocks a BUY when close is not above the MA', () => {
    const s = [9, 15, 15, 15, 15, 15];
    const below = [100, 11, 11, 11, 11, 11]; // close 11 < ma 12 at i=1 → BUY blocked
    expect(emitCrossSignals(s, V, M, below, { trendFilter: true })).toEqual([]);
    expect(emitCrossSignals(s, V, M, closes, { trendFilter: true })).toHaveLength(1); // close 100 > 12 → allowed
  });

  it('respects the exclusive `end` bound (forming-bar exclusion)', () => {
    // Cross at i=5 is excluded when end=5.
    const s = [9, 9, 9, 9, 9, 15];
    expect(emitCrossSignals(s, V, M, closes, { end: 5 })).toEqual([]);
    expect(emitCrossSignals(s, V, M, closes).map((e) => e.index)).toEqual([5]);
  });
});

describe('confidenceBand', () => {
  it('maps 0–100 confidence to the trader-facing labels', () => {
    expect(CONFIDENCE_FULL_SEP_OSC).toBe(20);
    expect(confidenceBand(95)).toBe('very strong');
    expect(confidenceBand(90)).toBe('very strong');
    expect(confidenceBand(89)).toBe('strong');
    expect(confidenceBand(70)).toBe('strong');
    expect(confidenceBand(69)).toBe('moderate');
    expect(confidenceBand(50)).toBe('moderate');
    expect(confidenceBand(49)).toBe('weak');
    expect(confidenceBand(0)).toBe('weak');
  });
});
