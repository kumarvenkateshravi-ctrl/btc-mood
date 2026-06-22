import { describe, it, expect } from 'vitest';
import { perBarSignals, buildRibbonSegments, TF_SECONDS } from './confluence';
import type { Candle } from './types';

function makeCandles(closes: number[], startTime = 1_700_000_000, stepSec = 900): Candle[] {
  return closes.map((c, i) => ({
    time: startTime + i * stepSec,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 100,
  }));
}

describe('perBarSignals', () => {
  it('returns one side per candle', () => {
    const candles = makeCandles(Array.from({ length: 60 }, (_, i) => 100 + i));
    const sides = perBarSignals(candles);
    expect(sides.length).toBe(candles.length);
    for (const s of sides) expect(['buy', 'sell', 'neutral']).toContain(s);
  });

  it('is neutral during warm-up', () => {
    const candles = makeCandles([100, 101, 102]);
    expect(perBarSignals(candles).every((s) => s === 'neutral')).toBe(true);
  });

  it('produces buy signals somewhere on an uptrend', () => {
    // A rising series yields buys while EMA9 > EMA21 (before RSI vetoes at the
    // extreme). We assert presence, not the exact bar — the scoring nuance
    // (RSI 80+ overbought lean) lives in scoreSignal and is tested there.
    const candles = makeCandles(Array.from({ length: 80 }, (_, i) => 100 + i * 2));
    expect(perBarSignals(candles)).toContain('buy');
  });

  it('returns [] for empty input', () => {
    expect(perBarSignals([])).toEqual([]);
  });
});

describe('buildRibbonSegments', () => {
  const candles = makeCandles(Array.from({ length: 40 }, (_, i) => 100 + i), 1_700_000_000, TF_SECONDS['15m']);
  const t0 = candles[0].time;
  const t1 = candles[candles.length - 1].time + TF_SECONDS['15m'];

  it('produces segments within the [0,100] domain', () => {
    const segs = buildRibbonSegments(candles, '15m', t0, t1);
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.leftPct).toBeGreaterThanOrEqual(-1e-6);
      expect(s.widthPct).toBeGreaterThan(0);
      expect(s.leftPct + s.widthPct).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('merges consecutive same-side bars', () => {
    const segs = buildRibbonSegments(candles, '15m', t0, t1);
    // The merge guarantee: no two adjacent segments share a side...
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].side).not.toBe(segs[i - 1].side);
    }
    // ...and merging yields fewer segments than bars.
    expect(segs.length).toBeLessThan(candles.length);
  });

  it('covers the full domain for the native timeframe', () => {
    const segs = buildRibbonSegments(candles, '15m', t0, t1);
    const total = segs.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('drops bars outside the domain', () => {
    // Domain covering only the last 5 bars.
    const lateT0 = candles[candles.length - 5].time;
    const segs = buildRibbonSegments(candles, '15m', lateT0, t1);
    const total = segs.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('returns [] for a zero-width domain', () => {
    expect(buildRibbonSegments(candles, '15m', t0, t0)).toEqual([]);
  });
});
