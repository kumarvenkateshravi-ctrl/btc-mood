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
  status: 'tp1', slCurrent: 100, entryIndex: 10, resolvedIndex: 15,
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
  it('renders exact entry/SL/TP numbers and status per trade', () => {
    publishVdTrades([trade({})]);
    const html = renderToStaticMarkup(<VdTradesPanel />);
    expect(html).toContain('@103.0');
    expect(html).toContain('SL 100.0');
    expect(html).toContain('TP3 113.0');
    expect(html).toContain('TP1 ✓');
  });
  it('empty state explains where trades come from', () => {
    const html = renderToStaticMarkup(<VdTradesPanel />);
    expect(html).toMatch(/No trades yet/);
  });
});
