// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __getStateForTest,
  __rehydrateForTest,
  __resetForTest,
  PAPER_STORAGE_KEY,
  closePosition,
  placeOrder,
  reconcileLiveTick,
  toggleTrailingSl,
} from './paperStore';

// The Task-1 API. Keeping the assertion at this boundary makes the test fail
// until the store actually accepts symbol identity, rather than silently
// exercising the legacy global tick path.
const reconcileSymbolTick = reconcileLiveTick as unknown as (
  symbol: string,
  price: number,
  ts: number,
) => void;

const BTC = 'BTCUSDT';
const GOLD = 'XAUUSD';

function resetStore() {
  window.localStorage.clear();
  __resetForTest();
}

function openLong(symbol: string, midPrice: number, tp: number | null, sl: number | null) {
  const result = placeOrder({
    symbol,
    side: 'buy',
    type: 'market',
    units: symbol === BTC ? 0.01 : 1,
    price: null,
    tp,
    sl,
    reduceOnly: false,
    postOnly: false,
    leverage: 10,
    midPrice,
  });
  expect(result.ok).toBe(true);
}

describe('symbol-safe live reconciliation', () => {
  beforeEach(resetStore);

  it('fills only the BTC order when a BTC tick reaches its limit', () => {
    placeOrder({
      symbol: BTC, side: 'buy', type: 'limit', units: 0.01, price: 64000,
      tp: null, sl: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    placeOrder({
      symbol: GOLD, side: 'buy', type: 'limit', units: 1, price: 2200,
      tp: null, sl: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 2300,
    });

    reconcileSymbolTick(BTC, 63900, 1000);

    const state = __getStateForTest();
    expect(state.positions[BTC]?.side).toBe('long');
    expect(state.positions[GOLD]).toBeFalsy();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.symbol).toBe(GOLD);
  });

  it('lets a BTC stop close BTC without touching the Gold position or its stop', () => {
    openLong(BTC, 65000, null, 63000);
    openLong(GOLD, 2300, null, 2200);

    reconcileSymbolTick(BTC, 62900, 1000);

    const state = __getStateForTest();
    expect(state.positions[BTC]).toBeFalsy();
    expect(state.positions[GOLD]).toMatchObject({ side: 'long', sl: 2200, entryPrice: 2300.1 });
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0]?.symbol).toBe(BTC);
  });

  it('moves only the BTC trailing stop on a BTC tick', () => {
    openLong(BTC, 65000, null, 63000);
    openLong(GOLD, 2300, null, 2200);
    toggleTrailingSl(BTC, true);
    toggleTrailingSl(GOLD, true);

    reconcileSymbolTick(BTC, 65500, 1000);

    const state = __getStateForTest();
    expect(state.positions[BTC]).toMatchObject({ trailingBest: 65500, sl: 63499.9 });
    expect(state.positions[GOLD]).toMatchObject({ trailingBest: 2300.1, sl: 2200 });
  });

  it('takes only the BTC profit, preserving Gold state, trade history, and balance effects', () => {
    openLong(BTC, 65000, 66000, 63000);
    openLong(GOLD, 2300, 2400, 2200);
    const balanceBefore = __getStateForTest().balance;

    reconcileSymbolTick(BTC, 66050, 1000);

    const state = __getStateForTest();
    expect(state.positions[BTC]).toBeFalsy();
    expect(state.positions[GOLD]).toMatchObject({ side: 'long', tp: 2400, sl: 2200 });
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0]).toMatchObject({ symbol: BTC, exitPrice: 66000 });
    expect(state.balance).toBeGreaterThan(balanceBefore);
  });

  it('persists the symbol on new closed trades', () => {
    openLong(GOLD, 2300, null, null);
    closePosition(2350, GOLD);

    expect(__getStateForTest().trades[0]).toMatchObject({ symbol: GOLD });
  });

  it('migrates legacy persisted BTC trades that have no symbol', () => {
    window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify({
      positions: {},
      pending: [],
      trades: [{
        id: 'legacy', positionId: 'old', side: 'sell', units: 1, price: 65000,
        fee: 1, realizedPnl: 10, ts: 1, direction: 'long', entryPrice: 64000,
        exitPrice: 65000, entryTs: 0, tp: null, sl: null,
      }],
      balance: 10010,
      initialBalance: 10000,
    }));

    __rehydrateForTest();

    expect(__getStateForTest().trades[0]).toMatchObject({ id: 'legacy', symbol: BTC });
  });
});
