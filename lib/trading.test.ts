import { describe, it, expect } from 'vitest';
import {
  positionSize,
  riskReward,
  formatRR,
  tradeDirection,
  tradePnlPct,
  tradeRR,
  tradeOutcome,
} from './trading';
import type { PaperTrade } from './paper';

function mkTrade(over: Partial<PaperTrade>): PaperTrade {
  return {
    id: 't',
    positionId: 'p',
    side: 'sell',
    units: 1,
    price: 110,
    fee: 0,
    realizedPnl: 10,
    ts: 2000,
    direction: 'long',
    entryPrice: 100,
    exitPrice: 110,
    entryTs: 1000,
    tp: 120,
    sl: 90,
    ...over,
  };
}

describe('trade derivations', () => {
  it('direction falls back to the closing side', () => {
    expect(tradeDirection(mkTrade({ direction: undefined, side: 'sell' }))).toBe('long');
    expect(tradeDirection(mkTrade({ direction: undefined, side: 'buy' }))).toBe('short');
  });
  it('P&L % is direction-aware', () => {
    expect(tradePnlPct(mkTrade({ entryPrice: 100, exitPrice: 110, direction: 'long' }))).toBeCloseTo(10, 6);
    expect(tradePnlPct(mkTrade({ entryPrice: 100, exitPrice: 90, direction: 'short' }))).toBeCloseTo(10, 6);
  });
  it('planned R:R from entry/tp/sl', () => {
    // long entry 100, tp 120 (reward 20), sl 90 (risk 10) → 2.0
    expect(tradeRR(mkTrade({}))).toBeCloseTo(2, 6);
    expect(tradeRR(mkTrade({ tp: null }))).toBeNull();
  });
  it('outcome detects TP / SL fills, else win/loss', () => {
    expect(tradeOutcome(mkTrade({ exitPrice: 120, tp: 120 }))).toBe('TP');
    expect(tradeOutcome(mkTrade({ exitPrice: 90, sl: 90, realizedPnl: -10 }))).toBe('SL');
    expect(tradeOutcome(mkTrade({ exitPrice: 105, tp: 120, sl: 90, realizedPnl: 5 }))).toBe('WIN');
    expect(tradeOutcome(mkTrade({ exitPrice: 100, tp: null, sl: null, realizedPnl: 0 }))).toBe('BE');
  });
});

describe('positionSize', () => {
  it('sizes so a stop-out loses exactly risk% of balance', () => {
    // $10k, 1% risk = $100 risk; SL distance $500 → 0.2 units.
    expect(positionSize(10_000, 1, 500)).toBeCloseTo(0.2, 9);
  });
  it('scales with risk %', () => {
    expect(positionSize(10_000, 2, 500)).toBeCloseTo(0.4, 9);
  });
  it('returns 0 for invalid inputs', () => {
    expect(positionSize(0, 1, 500)).toBe(0);
    expect(positionSize(10_000, 0, 500)).toBe(0);
    expect(positionSize(10_000, 1, 0)).toBe(0);
    expect(positionSize(10_000, 1, -5)).toBe(0);
  });
});

describe('riskReward', () => {
  it('computes long reward/risk', () => {
    // entry 100, tp 120 (reward 20), sl 90 (risk 10) → 2.0
    expect(riskReward('long', 100, 120, 90)).toBeCloseTo(2, 9);
  });
  it('computes short reward/risk', () => {
    // entry 100, tp 80 (reward 20), sl 110 (risk 10) → 2.0
    expect(riskReward('short', 100, 80, 110)).toBeCloseTo(2, 9);
  });
  it('returns null when TP/SL missing', () => {
    expect(riskReward('long', 100, null, 90)).toBeNull();
    expect(riskReward('long', 100, 120, null)).toBeNull();
  });
  it('returns null for wrong-side placement', () => {
    expect(riskReward('long', 100, 90, 95)).toBeNull(); // tp below entry
    expect(riskReward('long', 100, 120, 110)).toBeNull(); // sl above entry
  });
});

describe('formatRR', () => {
  it('formats as R:1', () => {
    expect(formatRR(2.5)).toBe('2.50 : 1');
    expect(formatRR(null)).toBe('—');
  });
});
