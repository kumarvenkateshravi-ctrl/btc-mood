import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeScannerSnapshot, takeFreshSignals, __resetAlertedForTest } from '@/lib/scanner/engine';
import { statsFromTrades, versionComparison } from '@/lib/scanner/analytics';
import { saveNewVersion, getStrategy } from '@/lib/scanner/scannerStore';
import { publishScannerSnapshot, __resetScannerUiForTest } from '@/lib/scanner/scannerUiStore';
import { createStrategy, setStrategyEnabled, __resetScannerStoreForTest } from '@/lib/scanner/scannerStore';
import { computeScannerSignals } from '@/lib/indicators/scannerSignals';
import ScannerSignalsDock, { SignalCard, currentR } from '@/components/scanner/ScannerSignalsDock';
import type { Candle } from '@/lib/types';
import type { Condition } from '@/lib/scanner/types';

const bar = (i: number, close: number): Candle =>
  ({ time: 1_600_000_000 + i * 900, open: close - 0.5, high: close + 0.6, low: close - 1.1, close, volume: 100 } as Candle);
const ramp = (n: number, step: number, start = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i, start + i * step));

const cond: Condition = { left: { source: 'rsi', output: 'rsi' }, op: 'gt', right: 55, tf: '15m' };

function seedStrategy(): string {
  const { strategy } = createStrategy({ name: 'Momentum', direction: 'long', tree: { logic: 'AND', children: [cond] } });
  setStrategyEnabled(strategy!.id, true);
  return strategy!.id;
}

beforeEach(() => {
  __resetScannerStoreForTest();
  __resetScannerUiForTest();
});

describe('S5: engine snapshot', () => {
  it('enabled strategies produce signals, trades and the event timeline', () => {
    seedStrategy();
    const snap = computeScannerSnapshot({ '15m': ramp(201, 1) }, '15m', 7);
    expect(snap.signals.length).toBe(1);
    expect(snap.trades[0].status).toBe('tp3');
    expect(snap.events.map((e) => e.eventType)).toContain('TradeClosed');
    expect(Object.values(snap.byStrategy)[0].name).toBe('Momentum');
  });
  it('caches on closed bars: identical input → same snapshot reference', () => {
    seedStrategy();
    const candles = { '15m': ramp(201, 1) };
    const a = computeScannerSnapshot(candles, '15m', 7);
    const b = computeScannerSnapshot(candles, '15m', 8); // same closed bars
    expect(b).toBe(a);
  });
  it('disabled strategies are excluded', () => {
    const { strategy } = createStrategy({ name: 'Off', direction: 'long', tree: { logic: 'AND', children: [cond] } });
    expect(strategy!.enabled).toBe(false);
    const snap = computeScannerSnapshot({ '15m': ramp(201, 1) }, '15m');
    expect(snap.signals).toHaveLength(0);
  });
});

describe('S5: scanner_signals overlay indicator', () => {
  it('renders arrows, boxes, outcome chips and levels from the published snapshot', () => {
    seedStrategy();
    const candles = ramp(201, 1);
    publishScannerSnapshot(computeScannerSnapshot({ '15m': candles }, '15m'));
    const res = computeScannerSignals(candles, { id: 'scanner_signals' });
    expect(res.signals.filter((s) => s !== 'neutral')).toHaveLength(1);
    const reward = res.plots.find((p) => p.id === 'Scan Reward')!;
    expect(reward.data.some((d) => d !== null)).toBe(true);
    expect(Object.keys(reward.zoneStyle?.flatLabels ?? {})).toHaveLength(1); // outcome chip
    expect(res.levels?.some((l) => l.title?.includes('Momentum'))).toBe(true);
  });
  it('toggles blank the corresponding layers', () => {
    seedStrategy();
    const candles = ramp(201, 1);
    publishScannerSnapshot(computeScannerSnapshot({ '15m': candles }, '15m'));
    const res = computeScannerSignals(candles, {
      id: 'scanner_signals',
      settings: { inputs: { showSignals: false, showRRBoxes: false, showTradeLevels: false }, styles: {}, visibility: {} },
    } as never);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
    expect(res.plots.find((p) => p.id === 'Scan Reward')!.data.every((d) => d === null)).toBe(true);
    expect(res.levels ?? []).toHaveLength(0);
  });
  it('renders a clean empty shape when nothing is published', () => {
    const candles = ramp(50, 1);
    const res = computeScannerSignals(candles, { id: 'scanner_signals' });
    expect(res.signals).toHaveLength(50);
    expect(res.plots).toHaveLength(2);
  });
});

describe('S7: analytics + alerts-lite', () => {
  const mkTrade = (realizedR: number | null, status = 'tp3') => ({
    signal: {
      id: `sig_${Math.random()}`, strategyId: 's', strategyVersionId: 's@v1',
      direction: 'long', side: 'buy', tf: '15m', index: 1, barTime: 0, createdAt: 0,
      entry: 100, stopLoss: 97, tp1: 103, tp2: 106, tp3: 109, confidence: 100, why: [],
    },
    status, slCurrent: 97, entryIndex: 1, entryTime: 0,
    resolvedIndex: realizedR != null ? 5 : null, resolvedTime: null,
    exitPrice: realizedR != null ? 100 + realizedR * 3 : null,
    barsHeld: 4, mfeR: Math.max(0, realizedR ?? 1), maeR: 0.5, realizedR,
    tp1Index: 2, tp2Index: realizedR != null && realizedR >= 2 ? 3 : undefined,
  }) as never;

  it('statsFromTrades: win rate, PF, streaks, drawdown, TP distribution', () => {
    const s = statsFromTrades([
      mkTrade(2), mkTrade(2), mkTrade(-1, 'stopped'), mkTrade(-1, 'stopped'), mkTrade(3),
    ], 1, 'test');
    expect(s.resolved).toBe(5);
    expect(s.winRate).toBeCloseTo(3 / 5, 6);
    expect(s.expectancy).toBeCloseTo(1, 6);       // (2+2−1−1+3)/5
    expect(s.profitFactor).toBeCloseTo(7 / 2, 6);
    expect(s.bestStreak).toBe(2);
    expect(s.worstStreak).toBe(2);
    expect(s.maxDrawdownR).toBeCloseTo(2, 6);
    expect(s.stopped).toBe(2);
    expect(s.tp1Hits).toBe(5);
  });

  it('versionComparison backtests every version deterministically', () => {
    const id = seedStrategy();
    saveNewVersion(id, { logic: 'AND', children: [{ ...cond, right: 60 }] }, 'Tighter RSI');
    const strat = getStrategy(id)!;
    const rows = versionComparison(strat, { '15m': ramp(201, 1) }, '15m');
    expect(rows).toHaveLength(2);
    expect(rows[0].version).toBe(1);
    expect(rows[1].note).toBe('Tighter RSI');
    expect(rows[0].signals).toBeGreaterThanOrEqual(1);
    expect(versionComparison(strat, { '15m': ramp(201, 1) }, '15m')).toEqual(rows);
  });

  it('takeFreshSignals alerts each live-edge signal exactly once', () => {
    __resetAlertedForTest();
    seedStrategy();
    const candles = ramp(201, 1);
    const snap = computeScannerSnapshot({ '15m': candles }, '15m');
    const sigTime = snap.signals[0].barTime;
    expect(takeFreshSignals(snap, sigTime, 900)).toHaveLength(1);
    expect(takeFreshSignals(snap, sigTime, 900)).toHaveLength(0); // once only
    __resetAlertedForTest();
    const lastClosed = candles[candles.length - 2].time + 900;
    expect(takeFreshSignals(snap, lastClosed + 999_999, 900)).toHaveLength(0); // stale never alerts
  });
});

describe('S5: interactive dock', () => {
  it('renders signal chips and the details card content', () => {
    seedStrategy();
    const snap = computeScannerSnapshot({ '15m': ramp(201, 1) }, '15m');
    const dock = renderToStaticMarkup(<ScannerSignalsDock snapshot={snap} midPrice={300} />);
    expect(dock).toContain('▲');
    const card = renderToStaticMarkup(
      <SignalCard trade={snap.trades[0]} snapshot={snap} midPrice={300} onClose={() => {}} />,
    );
    expect(card).toContain('BUY · Momentum v1');
    expect(card).toContain('Why it triggered');
    expect(card).toContain('Entry');
    expect(card).toContain('Realized R');
    expect(card).toContain('TradeClosed'); // event timeline
  });
  it('currentR: live for open trades, realized when resolved', () => {
    seedStrategy();
    const snap = computeScannerSnapshot({ '15m': ramp(201, 1) }, '15m');
    const t = snap.trades[0];
    expect(currentR(t, 999)).toBe(t.realizedR); // resolved → realized
    const open = { ...t, realizedR: null };
    const risk = Math.abs(t.signal.entry - t.signal.stopLoss);
    expect(currentR(open, t.signal.entry + risk)).toBeCloseTo(1, 6);
  });
});
