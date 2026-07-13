import { describe, it, expect } from 'vitest';
import {
  positionSizeFor,
  sessionStats,
  coachingNotes,
  tpProgress,
  DEFAULT_SESSION_CONFIG,
  SESSION_LEVERAGES,
  type TradeBehavior,
} from './sessionSim';
import type { PaperTrade } from '../paper';

const cfg = { ...DEFAULT_SESSION_CONFIG, startBalance: 1000, riskPct: 1, leverage: 1 as const };

describe('positionSizeFor', () => {
  it('sizes exactly like the spec: risk / (entry − stop)', () => {
    // $1000 balance, 1% risk = $10; entry 100, stop 95 → 2 units
    const r = positionSizeFor(cfg, 1000, 'buy', 100, 95);
    expect(r.ok).toBe(true);
    expect(r.riskAmount).toBe(10);
    expect(r.units).toBeCloseTo(2);
  });

  it('blocks undefined-risk trades: no stop = no trade', () => {
    expect(positionSizeFor(cfg, 1000, 'buy', 100, null).reason).toBe('no-stop');
  });

  it('blocks a stop on the wrong side of entry', () => {
    expect(positionSizeFor(cfg, 1000, 'buy', 100, 105).reason).toBe('stop-on-wrong-side');
    expect(positionSizeFor(cfg, 1000, 'sell', 100, 95).reason).toBe('stop-on-wrong-side');
  });

  it('enforces margin at 1x but allows the same trade at 10x', () => {
    // tight stop → huge size: entry 100, stop 99.9, risk $10 → 100 units = $10k notional
    const at1x = positionSizeFor({ ...cfg, leverage: 1 }, 1000, 'buy', 100, 99.9);
    expect(at1x.reason).toBe('insufficient-margin');
    const at10x = positionSizeFor({ ...cfg, leverage: 10 }, 1000, 'buy', 100, 99.9);
    expect(at10x.ok).toBe(true);
    expect(at10x.margin).toBeCloseTo(1000);
  });

  it('leverage choices are exactly 1x, 5x, 10x', () => {
    expect([...SESSION_LEVERAGES]).toEqual([1, 5, 10]);
  });
});

const trade = (pnl: number, over: Partial<PaperTrade> = {}): PaperTrade => ({
  id: 't', positionId: 'p', side: 'sell', units: 1, price: 100, fee: 0,
  realizedPnl: pnl, ts: 1000, entryTs: 400, entryPrice: 100, exitPrice: 100 + pnl, sl: 95,
  ...over,
});

describe('sessionStats', () => {
  it('computes balance, win rate, PF and drawdown over the closed sequence', () => {
    // store order is newest-first; oldest sequence: +30, -10, +20
    const s = sessionStats([trade(20), trade(-10), trade(30)], 1000);
    expect(s.balance).toBe(1040);
    expect(s.netPnl).toBe(40);
    expect(s.trades).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.profitFactor).toBeCloseTo(5);
    // dd after -10 from peak 1030: 10/1030
    expect(s.maxDrawdownPct).toBeCloseTo((10 / 1030) * 100, 5);
    expect(s.avgHoldSec).toBe(600);
  });

  it('handles an empty session', () => {
    const s = sessionStats([], 500);
    expect(s.balance).toBe(500);
    expect(s.trades).toBe(0);
    expect(s.winRate).toBe(0);
  });
});

const behavior = (over: Partial<TradeBehavior>): TradeBehavior => ({
  positionId: 'p', slMoves: 0, plannedRisk: 10, plannedTp: 130, entryPrice: 100,
  side: 'long', maxFavorablePrice: 100, exitKind: 'manual', exitPrice: 110, realizedPnl: 10,
  ...over,
});

describe('coaching', () => {
  it('tpProgress measures how far a manual exit got toward target', () => {
    expect(tpProgress(behavior({ exitPrice: 115 }))).toBeCloseTo(0.5); // 15 of 30
  });

  it('flags stop-loss moving, including losses bigger than planned', () => {
    const notes = coachingNotes([
      behavior({ slMoves: 3, exitKind: 'sl', exitPrice: 80, realizedPnl: -20 }),
      behavior({ slMoves: 2, exitKind: 'sl', exitPrice: 90, realizedPnl: -10 }),
    ]);
    const slNote = notes.find((n) => n.text.includes('Stop Loss'));
    expect(slNote?.tone).toBe('warn');
    expect(slNote?.text).toContain('5 times');
    expect(slNote?.text).toContain('1 loss');
  });

  it('flags exiting winners early', () => {
    const notes = coachingNotes([
      behavior({ exitPrice: 110, realizedPnl: 10 }), // 33% of target
      behavior({ exitPrice: 112, realizedPnl: 12 }), // 40%
    ]);
    expect(notes.some((n) => n.text.includes('exited winners early'))).toBe(true);
  });

  it('praises discipline when losses stay within plan and stops were never moved', () => {
    const notes = coachingNotes([
      behavior({ exitKind: 'sl', exitPrice: 95, realizedPnl: -10 }),
      behavior({ exitKind: 'tp', exitPrice: 130, realizedPnl: 30 }),
    ]);
    expect(notes.some((n) => n.tone === 'good' && n.text.includes('discipline'))).toBe(true);
  });
});
