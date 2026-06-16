import { describe, it, expect } from 'vitest';
import { computeStats } from './performance';
import type { PaperTrade } from './paper';

const t = (pnl: number, id = ''): PaperTrade => ({
  id: id || `t_${Math.random().toString(36).slice(2, 8)}`,
  positionId: 'p1',
  side: pnl >= 0 ? 'sell' : 'buy',
  units: 0.1,
  price: 100,
  fee: 0.004,
  realizedPnl: pnl,
  ts: 1_700_000_000,
});

describe('computeStats', () => {
  it('returns empty when no trades', () => {
    const s = computeStats([]);
    expect(s.empty).toBe(true);
    expect(s.count).toBe(0);
  });

  it('counts wins, losses, breakevens separately', () => {
    const s = computeStats([t(10), t(-5), t(0), t(3)]);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.breakevens).toBe(1);
  });

  it('computes total PnL', () => {
    const s = computeStats([t(10), t(-5), t(3)]);
    expect(s.totalPnl).toBeCloseTo(8, 6);
  });

  it('computes win rate correctly (excluding breakevens)', () => {
    const s = computeStats([t(10), t(-5), t(0), t(3)]);
    expect(s.winRatePct).toBeCloseTo(66.67, 1);
  });

  it('computes avg win and avg loss', () => {
    const s = computeStats([t(10), t(-5), t(3)]);
    expect(s.avgWin).toBeCloseTo(6.5, 6);
    expect(s.avgLoss).toBeCloseTo(-5, 6);
  });

  it('profit factor is gross profit / gross loss', () => {
    const s = computeStats([t(10), t(-5), t(3)]);
    expect(s.profitFactor).toBeCloseTo(13 / 5, 6);
  });

  it('profit factor is ∞ when no losses', () => {
    const s = computeStats([t(10), t(3)]);
    expect(s.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it('profit factor is 0 when no wins', () => {
    const s = computeStats([t(-5), t(-3)]);
    expect(s.profitFactor).toBe(0);
  });

  it('best and worst trade', () => {
    const s = computeStats([t(10), t(-5), t(3), t(-20)]);
    expect(s.bestTrade).toBe(10);
    expect(s.worstTrade).toBe(-20);
  });

  it('max drawdown from equity curve', () => {
    // Chronological (oldest first): +10 (peak=10), -15 (equity=-5, dd=15), +3 (back to -2)
    // The store stores newest-first; computeStats reverses internally.
    const trades = [t(3), t(-15), t(10)];
    const s = computeStats(trades);
    expect(s.maxDrawdown).toBeCloseTo(15, 6);
  });

  it('max drawdown is 0 when all trades are positive', () => {
    const s = computeStats([t(5), t(10), t(3)]);
    expect(s.maxDrawdown).toBe(0);
  });
});
