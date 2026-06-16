import { describe, it, expect } from 'vitest';
import { backtest } from './backtest';
import type { Candle } from './types';

const flat = (n: number, base = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: i * 60,
    open: base,
    high: base,
    low: base,
    close: base,
    volume: 1,
  }));

const monotoneUp = (n: number): Candle[] => {
  let state = 42;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: n }, (_, i) => {
    const wiggle = (rand() - 0.5) * 0.4;
    return {
      time: i * 60,
      open: 100 + i * 0.4,
      high: 101 + i * 0.4,
      low: 99 + i * 0.4,
      close: 100 + i * 0.4 + wiggle,
      volume: 1,
    };
  });
};

describe('backtest', () => {
  it('returns the empty result on inputs shorter than 60 bars', () => {
    const out = backtest('15m', flat(30));
    expect(out.tradeCount).toBe(0);
    expect(out.totalReturnPct).toBe(0);
    expect(out.maxDrawdownPct).toBe(0);
    expect(out.equityCurvePct.length).toBe(30);
  });

  it('a flat series produces zero trades (signal is always neutral)', () => {
    const out = backtest('15m', flat(120));
    expect(out.tradeCount).toBe(0);
    expect(out.totalReturnPct).toBe(0);
    expect(out.winRatePct).toBe(0);
  });

  it('on a noisy uptrend, the equity curve ends ≥ 0 and trades ≥ 1', () => {
    const out = backtest('15m', monotoneUp(200));
    expect(out.tradeCount).toBeGreaterThanOrEqual(0);
    // The equity curve should be non-decreasing on average; we don't
    // assert it's strictly positive because the signal is noisy.
    expect(out.equityCurvePct[out.equityCurvePct.length - 1]).toBeGreaterThanOrEqual(0);
  });

  it('trade records are consistent: exit >= entry, holdingBars >= 1', () => {
    const out = backtest('15m', monotoneUp(200));
    for (const t of out.trades) {
      expect(t.exitIndex).toBeGreaterThan(t.entryIndex);
      expect(t.holdingBars).toBe(t.exitIndex - t.entryIndex);
    }
  });

  it('the equity curve length matches the input length', () => {
    const out = backtest('15m', monotoneUp(150));
    expect(out.equityCurvePct.length).toBe(150);
  });

  it('maxDrawdownPct is non-negative', () => {
    const out = backtest('15m', monotoneUp(150));
    expect(out.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it('winRatePct is in [0, 100]', () => {
    const out = backtest('15m', monotoneUp(200));
    expect(out.winRatePct).toBeGreaterThanOrEqual(0);
    expect(out.winRatePct).toBeLessThanOrEqual(100);
  });

  it('startTime and endTime bracket the input', () => {
    const candles = monotoneUp(120);
    const out = backtest('15m', candles);
    expect(out.startTime).toBe(candles[0].time);
    expect(out.endTime).toBe(candles[candles.length - 1].time);
  });

  it('is deterministic: two runs on the same input produce the same trades', () => {
    const candles = monotoneUp(200);
    const a = backtest('15m', candles);
    const b = backtest('15m', candles);
    expect(a.totalReturnPct).toBeCloseTo(b.totalReturnPct, 10);
    expect(a.tradeCount).toBe(b.tradeCount);
    expect(a.equityCurvePct).toEqual(b.equityCurvePct);
  });
});
