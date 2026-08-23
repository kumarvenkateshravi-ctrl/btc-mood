import { describe, expect, it } from 'vitest';
import { chartNavigationLayoutForWidth, MOBILE_PRIMARY_TIMEFRAMES } from './chartNavigation';

describe('chart navigation responsive priority', () => {
  it('keeps identity, selected timeframe and safety context primary at every width', () => {
    for (const width of [360, 430, 768, 1024, 1440]) {
      expect(chartNavigationLayoutForWidth(width).primary).toEqual(
        expect.arrayContaining(['instrument', 'timeframe', 'market-state', 'execution-mode']),
      );
    }
  });

  it('uses touch-sized mobile controls with quick favorites and an explicit all-timeframes path', () => {
    const mobile = chartNavigationLayoutForWidth(390);
    expect(mobile.variant).toBe('mobile');
    expect(mobile.minTouchTarget).toBe(44);
    expect(mobile.timeframes).toEqual(MOBILE_PRIMARY_TIMEFRAMES);
    expect(mobile.secondary).toContain('all-timeframes');
    expect(mobile.secondary).toEqual(expect.arrayContaining(['chart-type', 'indicators', 'replay', 'settings']));
  });

  it('preserves direct timeframe access on tablet and desktop while progressively collapsing secondary controls', () => {
    expect(chartNavigationLayoutForWidth(800)).toMatchObject({ variant: 'tablet', timeframes: ['5m', '15m', '30m', '1h', '4h', '1d'] });
    expect(chartNavigationLayoutForWidth(1200)).toMatchObject({ variant: 'laptop', timeframes: ['5m', '15m', '30m', '1h', '4h', '1d'] });
    expect(chartNavigationLayoutForWidth(1600)).toMatchObject({ variant: 'desktop', timeframes: ['5m', '15m', '30m', '1h', '4h', '1d'] });
  });
});