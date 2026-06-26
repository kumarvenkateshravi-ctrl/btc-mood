import { describe, it, expect } from 'vitest';
import { perBarScore, runSetupBacktest, optimizeEntry, monteCarlo, confidenceScore, generateInsights, cid, type BacktestConfig } from './setupBacktest';
import type { Candle } from './types';

function series(n: number, base: number, trend: number, noise: number, seed: number): Candle[] {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return Array.from({ length: n }, (_, i) => {
    const close = base + i * trend + (rand() - 0.5) * noise;
    const o = base + i * trend;
    return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, close) + 2, low: Math.min(o, close) - 2, close, volume: 1000 + (i % 7) * 50 };
  });
}

// A permissive rule set so the simulator reliably produces trades on a trend.
function cfg(entryScore: number): BacktestConfig {
  return {
    entryConditions: [{ id: cid(), enabled: true, metric: 'Stack Score', operator: 'Greater Than', value: entryScore }],
    exitConditions: [
      { id: cid(), enabled: true, metric: 'Take Profit', operator: 'RR Greater Than', value: 2.5 },
      { id: cid(), enabled: true, metric: 'Stop Loss', operator: 'Fixed', value: 1.5 },
      { id: cid(), enabled: true, metric: 'Stack Score', operator: 'Less Than', value: 50 },
    ],
    riskPct: 1, initialCapital: 10_000, commissionPct: 0.1, slippagePct: 0.05, leverage: 5, allowShort: true,
  };
}

describe('perBarScore', () => {
  it('returns a 0–100 score per bar; an uptrend reads bullish', () => {
    const sc = perBarScore(series(320, 100, 0.4, 6, 7));
    expect(sc).toHaveLength(320);
    expect(Math.min(...sc)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...sc)).toBeLessThanOrEqual(100);
    expect(sc[sc.length - 1]).toBeGreaterThan(55);
  });
});

describe('runSetupBacktest (rule-based)', () => {
  const r = runSetupBacktest(series(360, 100, 0.35, 9, 3), cfg(65));
  it('produces trades with consistent, finite metrics', () => {
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.equity.length).toBe(r.trades.length);
    expect(r.distribution.total).toBe(r.trades.length);
    expect(r.distribution.wins + r.distribution.losses + r.distribution.breakeven).toBe(r.trades.length);
    expect(r.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(r.metrics.winRate).toBeLessThanOrEqual(100);
    expect(Number.isFinite(r.metrics.profitFactor)).toBe(true);
  });
  it('drawdown non-positive; 4 setup buckets covering all trades', () => {
    expect(r.drawdown.maxPct).toBeLessThanOrEqual(0);
    expect(r.setupBreakdown).toHaveLength(4);
    expect(r.setupBreakdown.reduce((s, b) => s + b.trades, 0)).toBe(r.trades.length);
  });
  it('stricter entry conditions reduce the number of trades', () => {
    const loose = runSetupBacktest(series(360, 100, 0.35, 9, 3), cfg(60)).trades.length;
    const strict = runSetupBacktest(series(360, 100, 0.35, 9, 3), cfg(85)).trades.length;
    expect(strict).toBeLessThanOrEqual(loose);
  });
  it('empty for too-short input', () => {
    expect(runSetupBacktest(series(100, 100, 0.3, 5, 1), cfg(65)).trades).toHaveLength(0);
  });
});

describe('derived analytics', () => {
  const c = series(360, 100, 0.35, 9, 3), r = runSetupBacktest(c, cfg(65));
  it('optimizeEntry reads the Stack Score condition and returns an optimal candidate', () => {
    const o = optimizeEntry(c, cfg(65));
    expect(o.current).toBe(65);
    expect([60, 65, 70, 75, 80, 82, 85, 90]).toContain(o.optimal);
  });
  it('monteCarlo best >= worst; confidence 0–100; insights non-empty', () => {
    const m = monteCarlo(r, cfg(65), 200);
    expect(m.best).toBeGreaterThanOrEqual(m.worst);
    const conf = confidenceScore(r);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(100);
    expect(generateInsights(r).length).toBeGreaterThan(0);
  });
});
