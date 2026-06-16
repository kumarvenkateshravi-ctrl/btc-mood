import { describe, it, expect, beforeEach } from 'vitest';
import {
  __getStateForTest,
  __resetForTest,
  clearActiveOrder,
  confirmActiveOrder,
  placeOrder,
  setActiveOrder,
  setPositionOverlay,
  toggleActiveOverlay,
  updateActiveOverlay,
  type ActiveOrder,
} from './paperStore';

const baseActive: ActiveOrder = {
  id: 'stg_test',
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  units: 0.5,
  entry: 65000,
  tp: 66000,
  sl: 64000,
  reduceOnly: false,
  postOnly: false,
  ocoGroup: null,
};

beforeEach(() => {
  __resetForTest();
});

describe('paperStore: active order staging', () => {
  it('sets, clears, and replaces the active order', () => {
    setActiveOrder(baseActive);
    expect(__getStateForTest().activeOrder).toEqual(baseActive);
    clearActiveOrder();
    expect(__getStateForTest().activeOrder).toBeNull();
  });

  it('updates a single field without replacing the rest', () => {
    setActiveOrder(baseActive);
    updateActiveOverlay('entry', 65100);
    const ao = __getStateForTest().activeOrder!;
    expect(ao.entry).toBe(65100);
    expect(ao.tp).toBe(66000);
    expect(ao.sl).toBe(64000);
    expect(ao.units).toBe(0.5);
  });

  it('clears tp/sl when set to null', () => {
    setActiveOrder(baseActive);
    updateActiveOverlay('tp', null);
    updateActiveOverlay('sl', null);
    const ao = __getStateForTest().activeOrder!;
    expect(ao.tp).toBeNull();
    expect(ao.sl).toBeNull();
  });

  it('toggleActiveOverlay turns the field on at the suggested price', () => {
    setActiveOrder({ ...baseActive, tp: null, sl: null });
    toggleActiveOverlay('tp', true, 67000);
    toggleActiveOverlay('sl', true, 63000);
    const ao = __getStateForTest().activeOrder!;
    expect(ao.tp).toBe(67000);
    expect(ao.sl).toBe(63000);

    toggleActiveOverlay('tp', false, 67000);
    expect(__getStateForTest().activeOrder!.tp).toBeNull();
  });

  it('toggleActiveOverlay preserves an existing value on enable', () => {
    setActiveOrder(baseActive);
    toggleActiveOverlay('tp', true, 99999);
    expect(__getStateForTest().activeOrder!.tp).toBe(66000);
  });
});

describe('paperStore: confirm active order', () => {
  it('promotes a limit staged order to a working order and clears staging', () => {
    setActiveOrder({ ...baseActive, type: 'limit', entry: 64000 });
    const res = confirmActiveOrder({ leverage: 10, midPrice: 65000 });
    expect(res.ok).toBe(true);
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    expect(s.positions.BTCUSDT).toBeFalsy(); // limit hasn't filled yet
    expect(s.pending.length).toBe(1);
    expect(s.pending[0].price).toBe(64000);
  });

  it('promotes a market staged order to a filled position with attached tp/sl', () => {
    setActiveOrder({ ...baseActive, type: 'market', entry: 65000 });
    const res = confirmActiveOrder({ leverage: 10, midPrice: 65000 });
    expect(res.ok).toBe(true);
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    const pos = s.positions.BTCUSDT;
    expect(pos?.side).toBe('long');
    expect(pos?.tp).toBe(66000);
    expect(pos?.sl).toBe(64000);
  });

  it('refuses to confirm when no staged order exists', () => {
    const res = confirmActiveOrder({ leverage: 10, midPrice: 65000 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no active order/i);
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
