import { beforeEach, describe, expect, it } from 'vitest';
import {
  __getStateForTest,
  __resetForTest,
  placeOrder,
  reconcileBar,
  updatePositionProtection,
} from './paperStore';

const BTC = 'BTCUSDT';

function open(side: 'buy' | 'sell' = 'buy', midPrice = 100) {
  expect(placeOrder({
    symbol: BTC, side, type: 'market', units: 1, price: null,
    tp: null, sl: null, reduceOnly: false, postOnly: false, leverage: 10, midPrice,
  }).ok).toBe(true);
}

function position() {
  return __getStateForTest().positions[BTC]!;
}

describe('atomic live protection updates', () => {
  beforeEach(() => __resetForTest());

  it('accepts valid long SL and TP together atomically', () => {
    open();

    expect(updatePositionProtection(BTC, { sl: 99, tp: 101 })).toEqual({ ok: true });
    expect(position()).toMatchObject({ sl: 99, tp: 101 });
  });

  it('rejects invalid long SL/TP inputs without changing either level', () => {
    open();
    updatePositionProtection(BTC, { sl: 99, tp: 101 });
    const before = { sl: position().sl, tp: position().tp };

    expect(updatePositionProtection(BTC, { sl: 100.1, tp: 99.9 })).toMatchObject({ ok: false });
    expect(position()).toMatchObject(before);
  });

  it('rejects invalid long SL, TP, NaN, and Infinity', () => {
    open();

    expect(updatePositionProtection(BTC, { sl: 100.1 })).toMatchObject({ ok: false });
    expect(updatePositionProtection(BTC, { tp: 99.9 })).toMatchObject({ ok: false });
    expect(updatePositionProtection(BTC, { sl: Number.NaN })).toMatchObject({ ok: false });
    expect(updatePositionProtection(BTC, { tp: Number.POSITIVE_INFINITY })).toMatchObject({ ok: false });
  });

  it('accepts valid short SL/TP and rejects inverted short levels', () => {
    open('sell');

    expect(updatePositionProtection(BTC, { sl: 101, tp: 99 })).toEqual({ ok: true });
    expect(updatePositionProtection(BTC, { sl: 99 })).toMatchObject({ ok: false });
    expect(updatePositionProtection(BTC, { tp: 101 })).toMatchObject({ ok: false });
    expect(position()).toMatchObject({ sl: 101, tp: 99 });
  });

  it('clears either or both protection levels without an intermediate invalid write', () => {
    open();
    updatePositionProtection(BTC, { sl: 99, tp: 101 });

    expect(updatePositionProtection(BTC, { sl: null })).toEqual({ ok: true });
    expect(position()).toMatchObject({ sl: null, tp: 101 });
    expect(updatePositionProtection(BTC, { sl: null, tp: null })).toEqual({ ok: true });
    expect(position()).toMatchObject({ sl: null, tp: null });
  });

  it('requires a valid stop before enabling trailing and never permits a long trail to loosen', () => {
    open();
    expect(updatePositionProtection(BTC, { trailingSl: true })).toMatchObject({ ok: false });
    updatePositionProtection(BTC, { sl: 99 });
    expect(updatePositionProtection(BTC, { trailingSl: true })).toEqual({ ok: true });

    reconcileBar(BTC, { time: 1, open: 100, high: 105, low: 104.5, close: 105, volume: 1 });
    const ratcheted = position().sl!;
    expect(ratcheted).toBeGreaterThan(99);
    reconcileBar(BTC, { time: 2, open: 105, high: 104.8, low: 104.2, close: 104.5, volume: 1 });
    expect(position().sl).toBe(ratcheted);
    expect(updatePositionProtection(BTC, { sl: 98 })).toMatchObject({ ok: false });
  });

  it('only ratchets a short trailing stop downward and disables deterministically', () => {
    open('sell');
    updatePositionProtection(BTC, { sl: 101, trailingSl: true });

    reconcileBar(BTC, { time: 1, open: 100, high: 95.5, low: 95, close: 95, volume: 1 });
    const ratcheted = position().sl!;
    expect(ratcheted).toBeLessThan(101);
    reconcileBar(BTC, { time: 2, open: 95, high: 95.8, low: 95.2, close: 95.5, volume: 1 });
    expect(position().sl).toBe(ratcheted);
    expect(updatePositionProtection(BTC, { trailingSl: false })).toEqual({ ok: true });
    expect(position()).toMatchObject({ trailingSl: false, trailingBest: null });
  });
});
