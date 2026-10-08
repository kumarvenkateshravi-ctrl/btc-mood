import { describe, expect, it } from 'vitest';
import { CHART_INDICATORS, isChartIndicatorId } from './chartIndicatorCatalog';

describe('chart indicator catalog', () => {
  it('continues to expose active chart indicators', () => {
    expect(CHART_INDICATORS.length).toBeGreaterThan(0);
    expect(isChartIndicatorId('ma_ribbon_tv')).toBe(true);
    expect(isChartIndicatorId('ma_fvg')).toBe(true);
    expect(isChartIndicatorId('session_volume_profile')).toBe(true);
  });
});
