import { describe, it, expect } from 'vitest';
import { deriveActivePosition, formatHeld } from './activePosition';
import { liquidationPrice } from '../tradeAnalysis';
import type { PaperPosition } from '../paper';

const pos = (over: Partial<PaperPosition> = {}): PaperPosition => ({
  id: 'p1', symbol: 'BTCUSDT', side: 'long', units: 0.05, entryPrice: 118420,
  realizedPnl: 0, feesPaid: 0, openedAt: 1_700_000_000, tp: 119780, sl: 117780,
  liquidated: false, leverage: 10, trailingSl: false, trailingBest: null, ...over,
});

describe('deriveActivePosition', () => {
  it('computes live P&L, R, and ROE for a long', () => {
    const v = deriveActivePosition(pos(), 118587.5, 1_700_000_000_000 + 18 * 60_000)!;
    expect(v.side).toBe('long');
    // raw pnl = units * (mark - entry)
    expect(v.pnlUsd).toBeCloseTo(0.05 * (118587.5 - 118420), 4);
    // risk = -units*(entry-sl) = -0.05*640 = -32; reward = 0.05*1360 = 68
    expect(v.riskUsd).toBeCloseTo(-32, 6);
    expect(v.rewardUsd).toBeCloseTo(68, 6);
    expect(v.rr).toBeCloseTo(68 / 32, 6); // ~2.125
    expect(v.pnlR).toBeCloseTo(v.pnlUsd / 32, 6);
    // margin (amount used) = notional / leverage
    expect(v.marginUsed).toBeCloseTo((0.05 * 118420) / 10, 4);
    expect(v.pnlPct).toBeCloseTo((v.pnlUsd / v.marginUsed) * 100, 6);
    expect(v.heldMs).toBe(18 * 60_000);
  });

  it('liquidation is leverage-aware and matches the shared helper', () => {
    const v = deriveActivePosition(pos({ leverage: 10 }), 118420)!;
    expect(v.liqPrice).toBeCloseTo(liquidationPrice(118420, 10, 'long'), 6);
    expect(v.liqPrice).toBeLessThan(118420); // long liquidates below entry
    // 1x liquidates far away; 10x much closer
    const v1 = deriveActivePosition(pos({ leverage: 1 }), 118420)!;
    expect(v1.liqDistancePct).toBeGreaterThan(v.liqDistancePct);
  });

  it('mirrors risk/reward and liq for a short', () => {
    const v = deriveActivePosition(pos({ side: 'short', entryPrice: 100, sl: 105, tp: 90 }), 100)!;
    expect(v.riskUsd).toBeCloseTo(-0.05 * 5, 6);
    expect(v.rewardUsd).toBeCloseTo(0.05 * 10, 6);
    expect(v.liqPrice).toBeGreaterThan(100); // short liquidates above entry
  });

  it('handles a position with no stop / target (R and RR null, not protected)', () => {
    const v = deriveActivePosition(pos({ sl: null, tp: null }), 118500)!;
    expect(v.riskUsd).toBeNull();
    expect(v.pnlR).toBeNull();
    expect(v.rr).toBeNull();
    expect(v.protected).toBe(false);
  });

  it('returns null for a flat/empty position', () => {
    expect(deriveActivePosition(pos({ side: 'flat', units: 0 }), 100)).toBeNull();
    expect(deriveActivePosition(pos(), 0)).toBeNull();
  });

  it('reflects trailing + protected flags', () => {
    const v = deriveActivePosition(pos({ trailingSl: true }), 118500)!;
    expect(v.trailing).toBe(true);
    expect(v.protected).toBe(true);
  });
});

describe('formatHeld', () => {
  it('formats seconds/minutes/hours/days', () => {
    expect(formatHeld(45_000)).toBe('45s');
    expect(formatHeld(18 * 60_000)).toBe('18 min');
    expect(formatHeld((2 * 60 + 4) * 60_000)).toBe('2h 4m');
    expect(formatHeld(3 * 60 * 60_000)).toBe('3h');
    expect(formatHeld((25 * 60) * 60_000)).toBe('1d 1h');
  });
});
