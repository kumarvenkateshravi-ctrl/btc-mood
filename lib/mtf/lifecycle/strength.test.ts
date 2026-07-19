import { describe, expect, it } from 'vitest';
import type { RegimeType, TimeframeSnapshot, HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import type { Verdict } from '../types';
import type { TrendStage } from './lifecycleTypes';
import { lifecycleStrength } from './strength';

const snap = (o: Partial<TimeframeSnapshot> & { timeframe: TimeframeSnapshot['timeframe']; bias: Verdict }): TimeframeSnapshot => ({
  agreement: 60, conflict: 0, confidence: 60, regime: 'trending_up' as RegimeType, regimeClarity: 60,
  trendFreshness: 80, momentumExhaustion: 40, ...o,
});
const hier = (o: Partial<HierarchyResult> & { controller: TimeframeSnapshot['timeframe'] }): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'bullish', alignment: 70, conflict: 30, controllerAuthority: 55,
  overallMarketState: 'range_bound' as OverallMarketState, transition: false,
  perTimeframe: {}, contributors: [], signals: [], warnings: [], ...o,
});

describe('lifecycleStrength', () => {
  const s = snap({ timeframe: '1d', bias: 'bullish', trendFreshness: 80, regimeClarity: 60, momentumExhaustion: 40 });
  const h = hier({ controller: '1d', alignment: 70, controllerAuthority: 55, conflict: 30 });

  it('breakout/confirmation = mean(freshness, alignment)', () => {
    expect(lifecycleStrength('breakout', s, h)).toBe(75); // round((80+70)/2)
    expect(lifecycleStrength('confirmation', s, h)).toBe(75);
  });
  it('trend_establishment/continuation = mean(regimeClarity, alignment, 100-exhaustion)', () => {
    expect(lifecycleStrength('trend_establishment', s, h)).toBe(63); // round((60+70+60)/3)
    expect(lifecycleStrength('continuation', s, h)).toBe(63);
  });
  it('healthy_pullback = controllerAuthority', () => {
    expect(lifecycleStrength('healthy_pullback', s, h)).toBe(55);
  });
  it('exhaustion/distribution = momentumExhaustion', () => {
    expect(lifecycleStrength('exhaustion', s, h)).toBe(40);
    expect(lifecycleStrength('distribution', s, h)).toBe(40);
  });
  it('reversal = conflict', () => {
    expect(lifecycleStrength('reversal', s, h)).toBe(30);
  });
  it('accumulation/range = regimeClarity', () => {
    expect(lifecycleStrength('accumulation', s, h)).toBe(60);
    expect(lifecycleStrength('range', s, h)).toBe(60);
  });
  it('always in [0,100] for every stage', () => {
    for (const stage of ['accumulation', 'breakout', 'confirmation', 'trend_establishment', 'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal', 'range'] as TrendStage[]) {
      const v = lifecycleStrength(stage, s, h);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
