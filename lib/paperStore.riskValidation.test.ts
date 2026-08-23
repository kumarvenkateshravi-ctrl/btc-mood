import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __getStateForTest, __resetForTest, placeOrder } from './paperStore';

const market = (overrides: Partial<Parameters<typeof placeOrder>[0]> = {}) => ({
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
  midPrice: 100,
  ...overrides,
});

describe('live entry risk validation', () => {
  beforeEach(() => __resetForTest());
  afterEach(() => __resetForTest());

  it('preserves valid explicit-unit entries', () => {
    expect(placeOrder(market({ sl: 95 }))).toEqual({ ok: true });
    expect(__getStateForTest().positions.BTCUSDT?.side).toBe('long');
  });

  it.each([
    ['long SL on the wrong side', market({ sl: 101 }), 'stop-on-wrong-side'],
    ['short SL on the wrong side', market({ side: 'sell', sl: 99 }), 'stop-on-wrong-side'],
    ['non-finite units', market({ units: Number.NaN }), 'invalid-units'],
    ['non-finite leverage', market({ leverage: Number.POSITIVE_INFINITY }), 'invalid-leverage'],
    ['insufficient margin', market({ units: 2_000 }), 'insufficient-margin'],
  ] as const)('rejects %s without creating a position', (_label, input, reason) => {
    const result = placeOrder(input);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(reason);
    expect(__getStateForTest().positions.BTCUSDT).toBeUndefined();
  });
});
