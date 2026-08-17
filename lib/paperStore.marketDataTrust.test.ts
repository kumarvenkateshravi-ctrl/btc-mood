import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __getStateForTest,
  __resetForTest,
  closePosition,
  placeOrder,
  setPositionOverlay,
} from './paperStore';
import { setMarketDataIntegrityForTest } from './marketDataTrust';

const order = () => ({
  symbol: 'BTCUSDT',
  side: 'buy' as const,
  type: 'market' as const,
  units: 1,
  price: null,
  tp: null,
  sl: null,
  reduceOnly: false,
  postOnly: false,
  leverage: 10,
  midPrice: 60_000,
});

describe('paper trading market-data trust gate', () => {
  beforeEach(() => {
    __resetForTest();
    setMarketDataIntegrityForTest('live');
  });

  afterEach(() => {
    setMarketDataIntegrityForTest('live');
  });

  it('rejects a new price-dependent order while data is stale without touching balance or positions', () => {
    const before = __getStateForTest();
    setMarketDataIntegrityForTest('stale');

    expect(placeOrder(order())).toEqual({ ok: false, error: 'Market data is not trustworthy for live execution' });
    expect(__getStateForTest().balance).toBe(before.balance);
    expect(__getStateForTest().positions).toEqual({});
  });

  it('blocks price-dependent closes but still permits non-price risk management', () => {
    expect(placeOrder(order()).ok).toBe(true);
    setMarketDataIntegrityForTest('partial');

    closePosition(61_000, 'BTCUSDT');
    expect(__getStateForTest().positions.BTCUSDT?.side).toBe('long');

    setPositionOverlay('sl', 59_000, 'BTCUSDT');
    expect(__getStateForTest().positions.BTCUSDT?.sl).toBe(59_000);
  });
});
