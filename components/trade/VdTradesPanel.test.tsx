import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VdTradesPanel, { vdStats } from './VdTradesPanel';
import { __resetContextForTest, publishVdTrades } from '@/lib/context/contextStore';
import type { VdTrade } from '@/lib/indicators/vdEngine';

const trade = (over: Partial<VdTrade>): VdTrade => ({
  signal: {
    side: 'buy', zoneId: 'D:demand:0', tf: 'D', index: 10,
    entry: 103, stopLoss: 100, tp1: 108, tp2: 110, tp3: 113,
    riskReward: 1.7, swept: false, confidence: 70,
  },
  status: 'tp1', slCurrent: 100, entryIndex: 10, entryTime: 1_600_000_000,
  resolvedIndex: 15, resolvedTime: 1_600_018_000,
  exitPrice: 108, barsHeld: 5, mfeR: 2, maeR: 0.4, realizedR: 1.67,
  ...over,
});

beforeEach(() => __resetContextForTest());

describe('vdStats', () => {
  it('computes win rate / avg R / PF over resolved trades', () => {
    const s = vdStats(
      [trade({ realizedR: 2 }), trade({ realizedR: -1, status: 'stopped' }), trade({ realizedR: null, status: 'active' })],
      () => 'A',
    );
    expect(s.resolved).toBe(2);
    expect(s.winRate).toBeCloseTo(0.5, 6);
    expect(s.avgR).toBeCloseTo(0.5, 6);
    expect(s.profitFactor).toBeCloseTo(2, 6);
    expect(s.byGrade.A?.n).toBe(2);
  });
});

describe('VdTradesPanel', () => {
  it('renders entry/SL/TP numbers, date/time, and profit in points', () => {
    publishVdTrades([trade({})]);
    const html = renderToStaticMarkup(<VdTradesPanel />);
    expect(html).toContain('Entry 103.0');
    expect(html).toContain('SL 100.0');
    expect(html).toContain('TP3 113.0');
    expect(html).toContain('TP1 ✓');
    expect(html).toMatch(/Profit \+5\.0 pts/);   // exit 108 − entry 103
    expect(html).toMatch(/Sep/);                  // entry date rendered
  });
  it('a stopped trade shows the loss in points with SL label', () => {
    publishVdTrades([trade({ status: 'stopped', exitPrice: 100, realizedR: -1 })]);
    const html = renderToStaticMarkup(<VdTradesPanel />);
    expect(html).toMatch(/Loss \(SL hit\) -3\.0 pts/);
  });
  it('an open trade shows live P/L (from midPrice) and best excursion', () => {
    publishVdTrades([trade({ status: 'active', exitPrice: null, resolvedIndex: null, resolvedTime: null, realizedR: null })]);
    const html = renderToStaticMarkup(<VdTradesPanel midPrice={110} />);
    expect(html).toMatch(/live \+7\.0 pts/);        // 110 − entry 103
    expect(html).toMatch(/best \+6\.0 pts/);        // mfeR 2 × risk 3
    const noMid = renderToStaticMarkup(<VdTradesPanel />);
    expect(noMid).toMatch(/Open · best \+6\.0 pts/); // graceful without midPrice
  });
  it('empty state explains where trades come from', () => {
    const html = renderToStaticMarkup(<VdTradesPanel />);
    expect(html).toMatch(/No trades yet/);
  });
});
