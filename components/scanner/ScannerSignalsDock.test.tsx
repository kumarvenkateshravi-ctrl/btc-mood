import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeScannerSnapshot } from '@/lib/scanner/engine';
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
