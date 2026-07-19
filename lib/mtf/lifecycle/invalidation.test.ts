import { describe, expect, it } from 'vitest';
import type { RegimeType, TimeframeSnapshot, HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import type { Verdict } from '../types';
import { checkInvalidation } from './invalidation';

const snap = (o: Partial<TimeframeSnapshot> & { timeframe: TimeframeSnapshot['timeframe']; bias: Verdict }): TimeframeSnapshot => ({
  agreement: 60, conflict: 0, confidence: 60, regime: 'trending_up' as RegimeType, regimeClarity: 60,
  trendFreshness: 60, momentumExhaustion: 0, ...o,
});
const hier = (o: Partial<HierarchyResult> & { controller: TimeframeSnapshot['timeframe'] }): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'bullish', alignment: 70, conflict: 0, controllerAuthority: 60,
  overallMarketState: 'range_bound' as OverallMarketState, transition: false,
  perTimeframe: {}, contributors: [], signals: [], warnings: [], ...o,
});

describe('checkInvalidation', () => {
  it('trend_establishment + low confidence → confidence collapse', () => {
    const r = checkInvalidation('trend_establishment', snap({ timeframe: '1d', bias: 'bullish', confidence: 20 }), hier({ controller: '1d' }));
    expect(r).toEqual({ invalidated: true, condition: 'confidence collapse' });
  });

  it('continuation + htfBias opposing direction → bias flip', () => {
    const r = checkInvalidation('continuation', snap({ timeframe: '1d', bias: 'bullish', confidence: 70 }), hier({ controller: '1d', htfBias: 'bearish' }));
    expect(r).toEqual({ invalidated: true, condition: 'bias flip' });
  });

  it('breakout + low freshness and alignment → false breakout', () => {
    const r = checkInvalidation('breakout', snap({ timeframe: '1d', bias: 'bullish', trendFreshness: 20 }), hier({ controller: '1d', alignment: 30 }));
    expect(r).toEqual({ invalidated: true, condition: 'false breakout' });
  });

  it('healthy_pullback + reversal_risk oms → pullback failed into reversal', () => {
    const r = checkInvalidation('healthy_pullback', snap({ timeframe: '1d', bias: 'bullish' }), hier({ controller: '1d', overallMarketState: 'reversal_risk' }));
    expect(r).toEqual({ invalidated: true, condition: 'pullback failed into reversal' });
  });

  it('a healthy trending case → not invalidated', () => {
    const r = checkInvalidation('trend_establishment', snap({ timeframe: '1d', bias: 'bullish', confidence: 80 }), hier({ controller: '1d', htfBias: 'bullish' }));
    expect(r).toEqual({ invalidated: false, condition: null });
  });

  it('confirmation checks BOTH trending-group and breakout-group conditions', () => {
    // confidence high enough, bias matches — but freshness/alignment weak → still false breakout
    const r = checkInvalidation('confirmation', snap({ timeframe: '1d', bias: 'bullish', confidence: 80, trendFreshness: 10 }), hier({ controller: '1d', alignment: 10 }));
    expect(r).toEqual({ invalidated: true, condition: 'false breakout' });
  });
});
