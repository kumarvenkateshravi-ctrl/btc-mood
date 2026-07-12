import { describe, it, expect } from 'vitest';
import { buildBacktestSeries } from './backtestSeries';
import type { VdTrade } from '@/lib/indicators/vdEngine';
import type { ScannerSignal } from './signals';

// Minimal resolved-trade factory (only the fields the series reads).
const trade = (realizedR: number | null, resolvedTime: number): VdTrade<ScannerSignal> =>
  ({
    signal: {} as ScannerSignal,
    status: realizedR != null ? (realizedR > 0 ? 'tp1' : 'stopped') : 'open',
    slCurrent: 0,
    entryIndex: 0,
    entryTime: resolvedTime - 100,
    resolvedIndex: realizedR != null ? 1 : null,
    resolvedTime: realizedR != null ? resolvedTime : null,
    exitPrice: null,
    barsHeld: 5,
    mfeR: 1,
    maeR: 0.3,
    realizedR,
  }) as VdTrade<ScannerSignal>;

describe('buildBacktestSeries', () => {
  it('reconstructs the equity curve in resolution order with drawdown', () => {
    // out of order in the array; sorted by resolvedTime: +2, -1, +1.5
    const s = buildBacktestSeries([trade(1.5, 300), trade(2, 100), trade(-1, 200)]);
    expect(s.equity.map((p) => p.equityR)).toEqual([2, 1, 2.5]);
    expect(s.equity.map((p) => p.peakR)).toEqual([2, 2, 2.5]);
    expect(s.equity.map((p) => p.drawdownR)).toEqual([0, 1, 0]);
    expect(s.maxDrawdownR).toBe(1);
    expect(s.finalEquityR).toBeCloseTo(2.5);
    expect(s.bestR).toBe(2);
    expect(s.worstR).toBe(-1);
  });

  it('ignores unresolved trades', () => {
    const s = buildBacktestSeries([trade(1, 100), trade(null, 200), trade(-0.5, 300)]);
    expect(s.equity.length).toBe(2);
    expect(s.finalEquityR).toBeCloseTo(0.5);
  });

  it('buckets outcomes into an odd, zero-centered histogram summing to the resolved count', () => {
    const s = buildBacktestSeries([trade(1, 100), trade(2, 200), trade(-1, 300), trade(-0.5, 400)]);
    expect(s.buckets.length % 2).toBe(1);
    expect(s.buckets.reduce((a, b) => a + b.count, 0)).toBe(4);
    // symmetric edges around zero
    expect(s.buckets[0].from).toBeCloseTo(-s.buckets[s.buckets.length - 1].to);
  });

  it('empty input yields a flat, safe result', () => {
    const s = buildBacktestSeries([]);
    expect(s.equity).toEqual([]);
    expect(s.finalEquityR).toBe(0);
    expect(s.maxDrawdownR).toBe(0);
    expect(s.buckets.reduce((a, b) => a + b.count, 0)).toBe(0);
  });
});
