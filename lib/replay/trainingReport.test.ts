import { describe, it, expect } from 'vitest';
import { buildTrainingReport } from './trainingReport';
import type { PaperTrade } from '@/lib/paper';

const trade = (realizedPnl: number, ts: number): PaperTrade =>
  ({ id: `t${ts}`, positionId: 'p', side: 'sell', units: 1, price: 100, fee: 0.1, realizedPnl, ts }) as PaperTrade;

describe('buildTrainingReport', () => {
  it('grades a strong session A with correct stats', () => {
    // newest-first, like the session store
    const trades = [trade(300, 4), trade(-100, 3), trade(250, 2), trade(200, 1)];
    const r = buildTrainingReport(trades, 120);
    expect(r.trades).toBe(4);
    expect(r.winRate).toBe(75);
    expect(r.totalPnl).toBe(650);
    expect(r.avgWin).toBe(250);
    expect(r.avgLoss).toBe(100);
    expect(r.payoffRatio).toBeCloseTo(2.5);
    expect(r.maxDrawdown).toBe(100); // 200→450 peak, dip to 350
    expect(r.bestTrade).toBe(300);
    expect(r.worstTrade).toBe(-100);
    expect(r.grade).toBe('A');
    expect(r.durationBars).toBe(120);
  });

  it('grades an all-loss session F with coaching note', () => {
    const r = buildTrainingReport([trade(-50, 2), trade(-80, 1)], 40);
    expect(r.winRate).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.gradeNote).toMatch(/win rate|setup/i);
  });

  it('handles the empty session', () => {
    const r = buildTrainingReport([], 10);
    expect(r.trades).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.gradeNote).toMatch(/No trades/);
  });
});
