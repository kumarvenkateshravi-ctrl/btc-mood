import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetForTest, __getStateForTest,
  setActiveOrder, updateActiveOverlay, toggleActiveOverlay,
  confirmActiveOrder, clearActiveOrder, newOrderId,
  type ActiveOrder,
} from './paperStore';

const stage = (over: Partial<ActiveOrder> = {}) =>
  setActiveOrder({
    id: newOrderId(), symbol: 'BTCUSDT', side: 'buy', type: 'limit',
    units: 10, entry: 61_937.85, tp: null, sl: null,
    reduceOnly: false, postOnly: false, ocoGroup: null,
    ...over,
  });

describe('staged order lifecycle', () => {
  beforeEach(() => __resetForTest());

  it('stage → drag entry/tp/sl → state reflects each drag', () => {
    stage();
    updateActiveOverlay('entry', 61_900);
    toggleActiveOverlay('tp', true, 62_069.33);
    toggleActiveOverlay('sl', true, 61_716.72);
    updateActiveOverlay('tp', 62_100);
    const a = __getStateForTest().activeOrder!;
    expect(a.entry).toBe(61_900);
    expect(a.tp).toBe(62_100);
    expect(a.sl).toBe(61_716.72);
  });

  it('confirm places the order and clears the stage', () => {
    stage();
    const res = confirmActiveOrder({ leverage: 10, midPrice: 61_956 });
    expect(res.ok).toBe(true);
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    expect(s.pending.length).toBe(1); // limit order is working
  });

  it('confirm of a market stage fills immediately into a position', () => {
    stage({ type: 'market' });
    const res = confirmActiveOrder({ leverage: 10, midPrice: 61_956 });
    expect(res.ok).toBe(true);
    expect(__getStateForTest().positions['BTCUSDT']?.side).toBe('long');
  });

  it('discard clears without placing', () => {
    stage();
    clearActiveOrder();
    const s = __getStateForTest();
    expect(s.activeOrder).toBeNull();
    expect(s.pending.length).toBe(0);
  });
});
