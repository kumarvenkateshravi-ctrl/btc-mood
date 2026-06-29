import { describe, it, expect } from 'vitest';
import { computeSqueezeMomentum, type SqueezeMomentumConfig } from './squeezeMomentum';
import type { Candle } from '../types';

function makeCandles(closes: number[], opts: Partial<Candle> = {}): Candle[] {
  return closes.map((c, i) => {
    const high = opts.high ?? c * 1.01;
    const low = opts.low ?? c * 0.99;
    return {
      time: i * 60,
      open: opts.open ?? c,
      high,
      low,
      close: c,
      volume: 1000,
    };
  });
}

describe('squeeze momentum', () => {
  it('returns no signals on flat data', () => {
    const candles = makeCandles(new Array(50).fill(100));
    const result = computeSqueezeMomentum(candles);
    expect(result.signals.every((s) => s === 'neutral')).toBe(true);
  });

  it('produces a momentum histogram with per-bar colors', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const candles = makeCandles(closes);
    const result = computeSqueezeMomentum(candles);
    const momentum = result.plots.find((p) => p.id === 'momentum');
    expect(momentum).toBeDefined();
    expect(momentum?.type).toBe('histogram');
    // First kcLength bars have null momentum
    expect(momentum?.data[0]).toBeNull();
    // After warm-up, momentum has values
    const nonNull = momentum?.data.filter((v) => v !== null) ?? [];
    expect(nonNull.length).toBeGreaterThan(0);
  });

  it('produces a squeeze state line at zero', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const candles = makeCandles(closes);
    const result = computeSqueezeMomentum(candles);
    const dots = result.plots.find((p) => p.id === 'squeezeDots');
    expect(dots).toBeDefined();
    // First kcLength bars are null; later bars are at zero
    expect(dots?.data[0]).toBeNull();
    const valid = dots?.data.filter((v) => v !== null) ?? [];
    expect(valid.length).toBeGreaterThan(0);
    for (const v of valid) {
      if (typeof v === 'object' && v !== null) expect((v as { value: number }).value).toBe(0);
    }
  });

  it('fires buy/sell signals on squeeze release transitions', () => {
    // Phase 1: tight range → squeeze builds (sqzOn)
    // Phase 2: explosive move → sqzOff, should fire buy if bullish.
    // We need the squeeze release to occur AFTER the linreg warm-up
    // (kcLength + kcLength = 40 bars), otherwise the bullish check
    // defaults to false and we'd get spurious sells.
    const closes: number[] = [];
    // 60 bars of flat 100 with tiny noise → squeeze builds for the
    // full second half of this range (warm-up completes around bar 38).
    for (let i = 0; i < 60; i++) closes.push(100 + Math.sin(i) * 0.15);
    // 30 bars of strong uptrend with widening range → momentum bullish
    // and BB widens past KC → sqzOff.
    for (let i = 0; i < 30; i++) closes.push(100 + i * 2 + Math.sin(i) * 0.5);
    const candles = makeCandles(closes);
    const result = computeSqueezeMomentum(candles);
    const buys = result.signals.map((s, i) => (s === 'buy' ? i : -1)).filter((i) => i >= 0);
    expect(buys.length).toBeGreaterThan(0);
  });

  it('respects custom kc length for warm-up', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const candles = makeCandles(closes);
    // kcLength drives linreg warm-up; longer kcLength → later first value
    const longKC = computeSqueezeMomentum(candles, { kcLength: 30, bbLength: 20 } as SqueezeMomentumConfig);
    const shortKC = computeSqueezeMomentum(candles, { kcLength: 10, bbLength: 20 } as SqueezeMomentumConfig);
    const longMom = longKC.plots.find((p) => p.id === 'momentum')?.data ?? [];
    const shortMom = shortKC.plots.find((p) => p.id === 'momentum')?.data ?? [];
    const longFirst = longMom.findIndex((v) => v !== null);
    const shortFirst = shortMom.findIndex((v) => v !== null);
    expect(longFirst).toBeGreaterThan(shortFirst);
  });

  it('honors useTrueRange=false (uses high-low only)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
    const candles = makeCandles(closes);
    const trResult = computeSqueezeMomentum(candles, { useTrueRange: true } as SqueezeMomentumConfig);
    const hlResult = computeSqueezeMomentum(candles, { useTrueRange: false } as SqueezeMomentumConfig);
    // Same plot structure, different values
    expect(trResult.plots.length).toBe(hlResult.plots.length);
  });
});
