// lib/indicators/signalBacktest.test.ts
import { describe, it, expect } from 'vitest';
import { backtestSignals } from './signalBacktest';
import type { SdSignal } from './signalTypes';

const base: SdSignal = {
  id: 'buy:D:demand:0', side: 'buy', timeframe: '1h', symbol: 'BTCUSDT',
  zoneId: 'D:demand:0', zoneTf: 'D', zoneKind: 'demand', status: 'tp1',
  entry: 100, stopLoss: 90, takeProfit1: 120, takeProfit2: 140, riskReward: 2, confidence: 70,
  explanation: { factors: [], summary: '', counterSignals: [] }, tier: 'strong', rejectReason: null,
  armedIndex: 1, triggeredIndex: 2, resolvedIndex: 5, createdAt: 0, resolvedAt: 5,
};

describe('backtestSignals', () => {
  it('computes win rate, avgR and profit factor over resolved signals', () => {
    const sigs: SdSignal[] = [
      { ...base, status: 'tp1', takeProfit1: 120, entry: 100, stopLoss: 90 },  // +2R
      { ...base, status: 'tp2', takeProfit2: 140, entry: 100, stopLoss: 90 },  // +4R
      { ...base, status: 'stopped', entry: 100, stopLoss: 90 },                 // -1R
      { ...base, status: 'expired' },                                            // excluded
    ];
    const r = backtestSignals(sigs);
    expect(r.trades).toBe(3);
    expect(r.winRate).toBeCloseTo(2 / 3, 6);
    expect(r.avgR).toBeCloseTo((2 + 4 - 1) / 3, 6);
    expect(r.profitFactor).toBeCloseTo(6 / 1, 6);
    expect(r.byTier.strong.trades).toBe(3);
  });
});
