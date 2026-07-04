import { describe, it, expect, beforeEach } from 'vitest';
import {
  __getStateForTest,
  __resetForTest,
  placeOrder,
  setPositionOverlay,
} from './paperStore';

beforeEach(() => {
  __resetForTest();
});

describe('paperStore: immediate place', () => {
  it('a market order fills immediately into a position with its tp/sl', () => {
    const res = placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.1, price: null,
      tp: 66000, sl: 64000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    expect(res.ok).toBe(true);
    const pos = __getStateForTest().positions.BTCUSDT;
    expect(pos?.side).toBe('long');
    expect(pos?.tp).toBe(66000);
    expect(pos?.sl).toBe(64000);
  });

  it('a limit order becomes a working order (does not fill yet)', () => {
    const res = placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'limit', units: 0.1, price: 64000,
      tp: null, sl: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65000,
    });
    expect(res.ok).toBe(true);
    const s = __getStateForTest();
    expect(s.positions.BTCUSDT).toBeFalsy();
    expect(s.pending.length).toBe(1);
    expect(s.pending[0].price).toBe(64000);
  });
});

describe('paperStore: position TP/SL overlay', () => {
  it('setPositionOverlay updates the open position', () => {
    placeOrder({
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'market',
      units: 0.5,
      price: null,
      tp: 66000,
      sl: 64000,
      reduceOnly: false,
      postOnly: false,
      leverage: 10,
      midPrice: 65000,
    });
    setPositionOverlay('tp', 67000, 'BTCUSDT');
    setPositionOverlay('sl', 63000, 'BTCUSDT');
    const pos = __getStateForTest().positions.BTCUSDT!;
    expect(pos.tp).toBe(67000);
    expect(pos.sl).toBe(63000);
  });

  it('setPositionOverlay on a flat symbol is a no-op', () => {
    setPositionOverlay('tp', 67000, 'ETHUSDT');
    expect(__getStateForTest().positions.ETHUSDT).toBeFalsy();
  });

  it('clears tp/sl when set to null', () => {
    placeOrder({
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'market',
      units: 0.1,
      price: null,
      tp: 66000,
      sl: 64000,
      reduceOnly: false,
      postOnly: false,
      leverage: 10,
      midPrice: 65000,
    });
    setPositionOverlay('tp', null, 'BTCUSDT');
    setPositionOverlay('sl', null, 'BTCUSDT');
    const pos = __getStateForTest().positions.BTCUSDT!;
    expect(pos.tp).toBeNull();
    expect(pos.sl).toBeNull();
  });

  it('supports multi-symbol positions', () => {
    placeOrder({
      symbol: 'ETHUSDT',
      side: 'buy',
      type: 'market',
      units: 1,
      price: null,
      tp: 3000,
      sl: 2500,
      reduceOnly: false,
      postOnly: false,
      leverage: 5,
      midPrice: 2700,
    });
    expect(__getStateForTest().positions.ETHUSDT?.side).toBe('long');
    expect(__getStateForTest().positions.BTCUSDT).toBeFalsy();
  });
});
