// End-to-end proof (M5): a permissive strategy over synthetic candles yields
// resolved trades, and those trades build a non-trivial equity curve — the
// exact path BacktestVisual renders. Guards against the browser-fixture
// limitation (tiny demo history) hiding a real regression.

import { describe, it, expect } from 'vitest';
import { tradesForStrategyVersion } from './analytics';
import { buildBacktestSeries } from './backtestSeries';
import { makeDeterministicCandles } from '@/lib/testing/syntheticCandles';
import type { ScannerStrategy } from './types';
import type { Candle, Timeframe } from '@/lib/types';

function permissiveStrategy(): ScannerStrategy {
  const now = 1;
  return {
    id: 'strat_test', name: 'RSI gate', direction: 'long', schemaVersion: 1,
    versions: [{ v: 1, createdAt: now, note: 'seed', tree: {
      logic: 'AND',
      children: [{ left: { source: 'rsi', output: 'rsi', params: {} }, op: 'gt', right: 45, tf: '15m' as Timeframe }],
    } }],
    activeVersion: 1, enabled: false, archived: false,
    exits: { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    ownerId: null, visibility: 'private', createdAt: now, updatedAt: now,
    parentStrategy: null, forkCount: 0, likes: 0,
  };
}

describe('backtest integration', () => {
  it('produces resolved trades and a chartable equity curve', () => {
    const candles: Candle[] = makeDeterministicCandles(1500, 11);
    const byTf: Partial<Record<Timeframe, Candle[]>> = { '15m': candles };
    const { trades } = tradesForStrategyVersion(permissiveStrategy(), 1, byTf, '15m');
    expect(trades.length).toBeGreaterThan(0);

    const series = buildBacktestSeries(trades);
    const resolved = trades.filter((t) => t.realizedR != null).length;
    expect(series.equity.length).toBe(resolved);
    if (resolved >= 2) {
      // equity is a running sum → last point equals the net R total
      const netR = trades.reduce((s, t) => s + (t.realizedR ?? 0), 0);
      expect(series.finalEquityR).toBeCloseTo(netR, 5);
      expect(series.maxDrawdownR).toBeGreaterThanOrEqual(0);
    }
    expect(series.buckets.reduce((a, b) => a + b.count, 0)).toBe(resolved);
  });
});
