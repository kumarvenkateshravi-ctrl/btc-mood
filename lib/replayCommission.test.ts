import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from './types';
import {
  __resetReplaySessionForTest,
  configureReplaySession,
  getReplaySessionStateForTest,
  rebuildReplaySessionAt,
  replayClose,
  replayOpenWithRisk,
  replayReconcileBar,
  setPendingLevels,
  setReplayActionContext,
  startReplaySession,
} from './replaySession';
import { applyFill, TAKER_FEE, type PaperFill } from './paper';
import { captureReplayDataset, clearReplayDataset } from './replay/replayDataset';

const commission = 0.001;
const config = {
  currency: 'USD' as const,
  startBalance: 10_000,
  commissionRate: commission,
  leverage: 1 as const,
  riskPct: 1,
};

const bar = (time: number, close: number, high = close + 1, low = close - 1): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 10,
});

function beginSession(rate = commission, candles: Candle[] = [bar(0, 100), bar(300, 100), bar(600, 100)]) {
  captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m', candlesByTf: { '5m': candles } as Partial<Record<Timeframe, Candle[]>> });
  startReplaySession('BTCUSDT', { startIndex: 1, executionTf: '5m' });
  setReplayActionContext(1, candles[1].time);
  configureReplaySession({ ...config, commissionRate: rate });
  setPendingLevels(95, 105);
  expect(replayOpenWithRisk('buy', candles[1].close, candles[1].time).ok).toBe(true);
  return candles;
}

describe('authoritative replay commission policy', () => {
  beforeEach(() => {
    __resetReplaySessionForTest();
    clearReplayDataset();
  });

  it('uses the configured commission for entry', () => {
    beginSession();
    const session = getReplaySessionStateForTest();
    const expected = session.position!.units * session.position!.entryPrice * commission;
    expect(session.position!.feesPaid).toBeCloseTo(expected, 10);
    expect(session.position!.realizedPnl).toBeCloseTo(-expected, 10);
  });

  it('uses the same configured commission for manual close', () => {
    const candles = beginSession();
    setReplayActionContext(2, candles[2].time);
    replayReconcileBar(candles[2]);
    replayClose(candles[2].close, candles[2].time);
    const trade = getReplaySessionStateForTest().trades[0];
    const expectedExitFee = trade.price * trade.units * commission;
    expect(trade.fee).toBeCloseTo(expectedExitFee, 10);
  });

  it('uses the same configured commission for SL exits', () => {
    const candles = beginSession();
    candles[2] = bar(600, 100, 101, 94);
    setReplayActionContext(2, candles[2].time);
    replayReconcileBar(candles[2]);
    const trade = getReplaySessionStateForTest().trades[0];
    expect(trade.price).toBe(95);
    expect(trade.fee).toBeCloseTo(trade.price * trade.units * commission, 10);
  });

  it('uses the same configured commission for TP exits', () => {
    const candles = beginSession();
    candles[2] = bar(600, 100, 106, 99);
    setReplayActionContext(2, candles[2].time);
    replayReconcileBar(candles[2]);
    const trade = getReplaySessionStateForTest().trades[0];
    expect(trade.price).toBe(105);
    expect(trade.fee).toBeCloseTo(trade.price * trade.units * commission, 10);
  });

  it('produces zero fees when replay commission is zero', () => {
    const candles = beginSession(0);
    setReplayActionContext(2, candles[2].time);
    replayClose(candles[2].close, candles[2].time);
    const session = getReplaySessionStateForTest();
    expect(session.position).toBeNull();
    expect(session.trades[0].fee).toBe(0);
    expect(session.trades[0].realizedPnl).toBeCloseTo((session.trades[0].price - session.trades[0].entryPrice!) * session.trades[0].units, 10);
  });

  it('freezes the configured commission after the first replay execution', () => {
    const candles = beginSession();
    configureReplaySession({ ...config, commissionRate: 0 });
    setReplayActionContext(2, candles[2].time);
    replayClose(candles[2].close, candles[2].time);
    const trade = getReplaySessionStateForTest().trades[0];
    expect(trade.fee).toBeCloseTo(trade.price * trade.units * commission, 10);
  });

  it('keeps the live paper engine default fee behavior', () => {
    const fill: PaperFill = {
      orderId: 'live-default',
      side: 'buy',
      units: 1,
      price: 100,
      feeRate: TAKER_FEE,
      fee: 100 * TAKER_FEE,
      ts: 1,
      leverage: 10,
    };
    const result = applyFill(null, fill, 'BTCUSDT', 1, 10);
    expect(result.position.feesPaid).toBe(100 * TAKER_FEE);
  });

  it('reconstructs identical fees, balance, and realized P&L after rewind', () => {
    const candles = beginSession();
    setReplayActionContext(2, candles[2].time);
    replayReconcileBar(candles[2]);
    replayClose(candles[2].close, candles[2].time);
    const before = getReplaySessionStateForTest();
    expect(rebuildReplaySessionAt(2)).toBe(true);
    const after = getReplaySessionStateForTest();
    expect(after.position).toEqual(before.position);
    expect(after.trades).toEqual(before.trades);
    expect(after.behaviors).toEqual(before.behaviors);
    expect(after.startBalance + after.trades.reduce((sum, trade) => sum + trade.realizedPnl, 0))
      .toBeCloseTo(before.startBalance + before.trades.reduce((sum, trade) => sum + trade.realizedPnl, 0), 10);
  });
});
