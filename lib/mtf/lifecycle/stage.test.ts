import { describe, expect, it } from 'vitest';
import type { RegimeType, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import type { HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import type { Verdict } from '../types';
import { classifyStage } from './stage';

const snap = (o: Partial<TimeframeSnapshot> & { timeframe: TimeframeSnapshot['timeframe']; bias: Verdict }): TimeframeSnapshot => ({
  agreement: 60, conflict: 0, confidence: 60, regime: 'trending_up' as RegimeType, regimeClarity: 60,
  trendFreshness: 0, momentumExhaustion: 0, ...o,
});
const hier = (o: Partial<HierarchyResult> & { controller: TimeframeSnapshot['timeframe'] }): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'bullish', alignment: 60, conflict: 0, controllerAuthority: 60,
  overallMarketState: 'range_bound' as OverallMarketState, transition: false,
  perTimeframe: {}, contributors: [], signals: [], warnings: [], ...o,
});

describe('classifyStage', () => {
  it('compression + bullish → accumulation', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'compression' });
    const r = classifyStage(s, hier({ controller: '1d' }));
    expect(r.stage).toBe('accumulation');
    expect(r.direction).toBe('bullish');
  });

  it('compression + bearish → distribution', () => {
    const s = snap({ timeframe: '1d', bias: 'bearish', regime: 'compression' });
    expect(classifyStage(s, hier({ controller: '1d' })).stage).toBe('distribution');
  });

  it('expansion + fresh + directional → breakout (exact stageConfidence)', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'expansion', trendFreshness: 85, confidence: 65 });
    const r = classifyStage(s, hier({ controller: '1d' }));
    expect(r.stage).toBe('breakout');
    expect(r.stageConfidence).toBe(75); // round(0.5·85 + 0.5·65)
  });

  it('ranging → range', () => {
    const s = snap({ timeframe: '1d', bias: 'neutral', regime: 'ranging' });
    expect(classifyStage(s, hier({ controller: '1d' })).stage).toBe('range');
  });

  it('trending + reversal_risk (controller) → reversal (exact stageConfidence)', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up', confidence: 70 });
    const r = classifyStage(s, hier({ controller: '1d', overallMarketState: 'reversal_risk', conflict: 80 }));
    expect(r.stage).toBe('reversal');
    expect(r.stageConfidence).toBe(75); // round(0.5·80 + 0.5·70)
  });

  it('trending + high exhaustion → exhaustion', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up', momentumExhaustion: 85 });
    expect(classifyStage(s, hier({ controller: '1d' })).stage).toBe('exhaustion');
  });

  it('trending + *_pullback (controller) → healthy_pullback', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up' });
    expect(classifyStage(s, hier({ controller: '1d', overallMarketState: 'bullish_pullback' })).stage).toBe('healthy_pullback');
  });

  it('trending + *_continuation (controller) → continuation', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up' });
    expect(classifyStage(s, hier({ controller: '1d', overallMarketState: 'bullish_continuation' })).stage).toBe('continuation');
  });

  it('trending + high freshness → breakout', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up', trendFreshness: 80 });
    expect(classifyStage(s, hier({ controller: '1d' })).stage).toBe('breakout');
  });

  it('trending + midFreshness + alignConfirm (controller) → confirmation', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up', trendFreshness: 45 });
    expect(classifyStage(s, hier({ controller: '1d', alignment: 65 })).stage).toBe('confirmation');
  });

  it('trending + else → trend_establishment', () => {
    const s = snap({ timeframe: '1d', bias: 'bullish', regime: 'trending_up', trendFreshness: 20 });
    expect(classifyStage(s, hier({ controller: '1d', alignment: 20 })).stage).toBe('trend_establishment');
  });

  it('non-controller TF: oms-branches do not apply (coarse form)', () => {
    // '4h' is NOT the controller ('1d' is); oms is bullish_pullback but must be ignored for '4h'.
    const s = snap({ timeframe: '4h', bias: 'bullish', regime: 'trending_up', trendFreshness: 20 });
    const r = classifyStage(s, hier({ controller: '1d', overallMarketState: 'bullish_pullback' }));
    expect(r.stage).toBe('trend_establishment'); // falls through to else, not healthy_pullback
  });

  it('stageConfidence is always in [0,100]', () => {
    for (const regime of ['trending_up', 'trending_down', 'ranging', 'compression', 'expansion'] as RegimeType[]) {
      const s = snap({ timeframe: '1h', bias: 'bearish', regime, trendFreshness: 50, momentumExhaustion: 50, confidence: 50 });
      const r = classifyStage(s, hier({ controller: '1d' }));
      expect(r.stageConfidence).toBeGreaterThanOrEqual(0);
      expect(r.stageConfidence).toBeLessThanOrEqual(100);
    }
  });
});
