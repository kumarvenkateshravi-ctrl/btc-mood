import { describe, it, expect } from 'vitest';
import { generateSampleEntries, analyzeJournal, mapPaperTrades, SETUPS } from './journalEngine';
import type { PaperTrade } from './paper';

describe('generateSampleEntries', () => {
  it('is deterministic and produces the requested count', () => {
    const a = generateSampleEntries(120, 7, 1_700_000_000_000);
    const b = generateSampleEntries(120, 7, 1_700_000_000_000);
    expect(a).toHaveLength(120);
    expect(a[0].id).toBe(b[0].id);
    expect(a[5].pnl).toBe(b[5].pnl);
  });
  it('entries carry a valid setup, outcome and 0–100 discipline', () => {
    for (const e of generateSampleEntries(60, 3)) {
      expect(SETUPS).toContain(e.setup);
      expect(['Win', 'Loss', 'Breakeven']).toContain(e.outcome);
      expect(e.discipline).toBeGreaterThanOrEqual(0);
      expect(e.discipline).toBeLessThanOrEqual(100);
    }
  });
});

describe('analyzeJournal', () => {
  const entries = generateSampleEntries(268, 42, 1_700_000_000_000);
  const a = analyzeJournal(entries);

  it('performance totals are consistent', () => {
    expect(a.performance.total).toBe(268);
    expect(a.performance.winning + a.performance.losing + a.performance.breakeven).toBe(268);
    expect(a.performance.winRate).toBeGreaterThanOrEqual(0);
    expect(a.performance.winRate).toBeLessThanOrEqual(100);
    expect(Number.isFinite(a.performance.profitFactor)).toBe(true);
    expect(Number.isFinite(a.performance.expectancy)).toBe(true);
  });
  it('setup breakdown trades sum to the total', () => {
    expect(a.bySetup.reduce((s, b) => s + b.trades, 0)).toBe(268);
  });
  it('emotions percentages and discipline are bounded', () => {
    for (const e of a.emotions) { expect(e.pct).toBeGreaterThanOrEqual(0); expect(e.winRate).toBeLessThanOrEqual(100); }
    expect(a.discipline.score).toBeGreaterThanOrEqual(0);
    expect(a.discipline.score).toBeLessThanOrEqual(100);
    expect(a.discipline.checks).toHaveLength(6);
  });
  it('equity has a point per trade; calendar + goals + insights populated', () => {
    expect(a.equity).toHaveLength(268);
    expect(a.calendar.length).toBeGreaterThan(0);
    expect(a.goals.length).toBe(5);
    expect(a.insights.length).toBeGreaterThan(0);
  });
});

describe('mapPaperTrades', () => {
  it('maps a closed paper trade into a journal entry', () => {
    const t: PaperTrade = { id: 'x', positionId: 'p', side: 'sell', units: 1, price: 110, fee: 0, realizedPnl: 10, ts: 2000, direction: 'long', entryPrice: 100, exitPrice: 110, entryTs: 1400, tp: 120, sl: 90 };
    const [e] = mapPaperTrades([t], 'BTCUSDT');
    expect(e.direction).toBe('Long');
    expect(e.outcome).toBe('Win');
    expect(e.asset).toBe('BTCUSDT');
    expect(e.holdingMin).toBe(10);
  });
});
