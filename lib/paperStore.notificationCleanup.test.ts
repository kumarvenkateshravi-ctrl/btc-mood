// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTest,
  __getStateForTest,
  placeOrder,
  reconcileBar,
  reconcileLiveTick,
  subscribeForTest,
} from './paperStore';

const bar = (time: number, close = 65_000) => ({
  time,
  open: close,
  high: close + 10,
  low: close - 10,
  close,
  volume: 1,
});

describe('paper-store no-op reconciliation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetForTest();
  });

  it('does not persist or notify when an active position is untouched', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 70_000, sl: 60_000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000,
    });
    const writes = vi.spyOn(window.localStorage, 'setItem');
    writes.mockClear();
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);

    reconcileBar('BTCUSDT', bar(1000));

    expect(writes).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(__getStateForTest().positions.BTCUSDT?.side).toBe('long');
    unsubscribe();
    writes.mockRestore();
  });

  it('does not persist or notify for repeated no-movement live ticks', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: 70_000, sl: 60_000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000,
    });
    const writes = vi.spyOn(window.localStorage, 'setItem');
    writes.mockClear();
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);

    reconcileLiveTick('BTCUSDT', 65_001, 1000);
    reconcileLiveTick('BTCUSDT', 65_001, 1001);

    expect(writes).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    writes.mockRestore();
  });

  it('still persists and notifies when a stop actually fills', () => {
    placeOrder({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', units: 0.01, price: null,
      tp: null, sl: 64_000, reduceOnly: false, postOnly: false, leverage: 10, midPrice: 65_000,
    });
    const writes = vi.spyOn(window.localStorage, 'setItem');
    writes.mockClear();
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);

    reconcileLiveTick('BTCUSDT', 63_900, 1000);

    expect(writes).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(__getStateForTest().positions.BTCUSDT).toBeFalsy();
    unsubscribe();
    writes.mockRestore();
  });
});
