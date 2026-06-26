import { describe, it, expect } from 'vitest';
import {
  analyzeTrade,
  liquidationPrice,
  breakEvenWinRate,
  riskZone,
  exposureLevel,
  type TradeInput,
} from './tradeAnalysis';

const baseLong: TradeInput = {
  balance: 10_000,
  riskPct: 1,
  entry: 62_713.7,
  stopLoss: 62_100,
  takeProfit: 64_600,
  leverage: 10,
  side: 'long',
};

describe('liquidationPrice', () => {
  it('long liquidates below entry by (1/lev − mmr)', () => {
    // 10x, mmr 0.5% → factor 0.095 → 0.905·entry
    expect(liquidationPrice(62_713.7, 10, 'long', 0.005)).toBeCloseTo(62_713.7 * 0.905, 6);
  });
  it('short liquidates above entry by the same factor', () => {
    expect(liquidationPrice(62_713.7, 10, 'short', 0.005)).toBeCloseTo(62_713.7 * 1.095, 6);
  });
});

describe('breakEvenWinRate', () => {
  it('is 1/(1+rr)', () => {
    expect(breakEvenWinRate(3)).toBeCloseTo(0.25, 9);
    expect(breakEvenWinRate(1)).toBeCloseTo(0.5, 9);
  });
  it('is null for missing/invalid rr', () => {
    expect(breakEvenWinRate(null)).toBeNull();
    expect(breakEvenWinRate(0)).toBeNull();
  });
});

describe('riskZone', () => {
  it('bands at 1% and 2%', () => {
    expect(riskZone(1)).toBe('low');
    expect(riskZone(2)).toBe('moderate');
    expect(riskZone(3)).toBe('high');
  });
});

describe('exposureLevel', () => {
  it('bands at 1× and 3× notional/balance', () => {
    expect(exposureLevel(5_000, 10_000).level).toBe('low');
    expect(exposureLevel(20_000, 10_000).level).toBe('moderate');
    expect(exposureLevel(40_000, 10_000).level).toBe('high');
  });
});

describe('analyzeTrade — internal consistency', () => {
  const a = analyzeTrade(baseLong);

  it('risk amount = balance × risk%', () => {
    expect(a.riskAmount).toBeCloseTo(100, 9);
  });

  it('an SL hit loses exactly the risk amount (the whole point)', () => {
    expect(a.potentialLoss).toBeCloseTo(a.riskAmount, 6);
    expect(a.potentialLoss).toBeCloseTo(100, 6);
  });

  it('position size is risk-based: riskAmount / slDistance', () => {
    expect(a.slDistance).toBeCloseTo(613.7, 6);
    expect(a.positionSize).toBeCloseTo(100 / 613.7, 9);
  });

  it('position value, % of account and margin are consistent', () => {
    expect(a.positionValue).toBeCloseTo(a.positionSize * 62_713.7, 6);
    expect(a.pctOfAccount).toBeCloseTo((a.positionValue / 10_000) * 100, 6);
    expect(a.marginRequired).toBeCloseTo(a.positionValue / 10, 6);
  });

  it('reward, R:R and break-even win rate line up', () => {
    expect(a.reward).toBeCloseTo(1_886.3, 6);
    expect(a.rr!).toBeCloseTo(1_886.3 / 613.7, 6);
    expect(a.breakEvenWinRate!).toBeCloseTo(1 / (1 + 1_886.3 / 613.7), 9);
    expect(a.potentialProfit).toBeCloseTo(a.positionSize * 1_886.3, 6);
  });

  it('what-if-SL drains exactly the risk', () => {
    expect(a.whatIfStopLoss.before).toBe(10_000);
    expect(a.whatIfStopLoss.after).toBeCloseTo(9_900, 6);
    expect(a.whatIfStopLoss.changePct).toBeCloseTo(-1, 6);
  });

  it('a clean 1% / R:R≈3 setup scores Excellent', () => {
    expect(a.health.score).toBe(100);
    expect(a.health.rating).toBe('Excellent');
    expect(a.health.checklist.every((c) => c.pass)).toBe(true);
  });
});

describe('analyzeTrade — degenerate / risky setups', () => {
  it('no stop loss → size 0, SL check fails, low score', () => {
    const a = analyzeTrade({ ...baseLong, stopLoss: null });
    expect(a.positionSize).toBe(0);
    expect(a.health.checklist.find((c) => c.label === 'Stop loss set')!.pass).toBe(false);
    expect(a.health.score).toBeLessThan(85);
    expect(a.health.tips.some((t) => /stop loss/i.test(t))).toBe(true);
  });

  it('wrong-side SL (long with SL above entry) is not counted as set', () => {
    const a = analyzeTrade({ ...baseLong, stopLoss: 63_000 });
    expect(a.rr).toBeNull(); // riskReward rejects wrong-side
    expect(a.health.checklist.find((c) => c.label === 'Stop loss set')!.pass).toBe(false);
  });

  it('high risk % flips the risk zone and fails the risk check', () => {
    const a = analyzeTrade({ ...baseLong, riskPct: 5 });
    expect(a.riskZone).toBe('high');
    expect(a.health.checklist.find((c) => c.label === 'Risk ≤ 2%')!.pass).toBe(false);
  });

  it('poor R:R (TP too close) fails the R:R check', () => {
    const a = analyzeTrade({ ...baseLong, takeProfit: 62_900 });
    expect(a.rr!).toBeLessThan(2);
    expect(a.health.checklist.find((c) => c.label === 'Risk/Reward ≥ 1:2')!.pass).toBe(false);
  });
});
