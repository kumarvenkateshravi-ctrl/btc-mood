import { describe, it, expect } from 'vitest';
import { priceAlertsToFire, sideForLevel, type PriceAlert } from './priceAlerts';

function alert(over: Partial<PriceAlert>): PriceAlert {
  return {
    id: 'a',
    symbol: 'BTCUSDT',
    price: 100,
    side: 'above',
    enabled: true,
    createdAt: 0,
    lastFiredAt: null,
    ...over,
  };
}

describe('sideForLevel', () => {
  it('is above when the level is at/over the reference', () => {
    expect(sideForLevel(110, 100)).toBe('above');
    expect(sideForLevel(90, 100)).toBe('below');
  });
});

describe('priceAlertsToFire', () => {
  it('fires an above-alert on an upward cross', () => {
    const fired = priceAlertsToFire([alert({ price: 100, side: 'above' })], 'BTCUSDT', 99, 101);
    expect(fired.length).toBe(1);
  });

  it('does not fire an above-alert when price stays below', () => {
    expect(priceAlertsToFire([alert({ price: 100, side: 'above' })], 'BTCUSDT', 95, 99)).toEqual([]);
  });

  it('fires a below-alert on a downward cross', () => {
    const fired = priceAlertsToFire([alert({ price: 100, side: 'below' })], 'BTCUSDT', 101, 99);
    expect(fired.length).toBe(1);
  });

  it('ignores disabled alerts and other symbols', () => {
    const alerts = [
      alert({ id: 'x', enabled: false, price: 100, side: 'above' }),
      alert({ id: 'y', symbol: 'ETHUSDT', price: 100, side: 'above' }),
    ];
    expect(priceAlertsToFire(alerts, 'BTCUSDT', 99, 101)).toEqual([]);
  });

  it('ignores non-finite prices', () => {
    expect(priceAlertsToFire([alert({})], 'BTCUSDT', NaN, 101)).toEqual([]);
  });
});
