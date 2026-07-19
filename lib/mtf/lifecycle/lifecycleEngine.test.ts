import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import type { RegimeType, TimeframeSnapshot, HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import type { Verdict } from '../types';
import { buildTimeframeSnapshots } from '../timeframe/snapshots';
import { computeTimeframeHierarchy } from '../timeframe/hierarchy';
import { computeTrendLifecycle } from './lifecycleEngine';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

const snap = (o: Partial<TimeframeSnapshot> & { timeframe: TimeframeSnapshot['timeframe']; bias: Verdict }): TimeframeSnapshot => ({
  agreement: 60, conflict: 0, confidence: 60, regime: 'trending_up' as RegimeType, regimeClarity: 60,
  trendFreshness: 60, momentumExhaustion: 0, ...o,
});
const hier = (o: Partial<HierarchyResult> & { controller: TimeframeSnapshot['timeframe'] }): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'bullish', alignment: 70, conflict: 0, controllerAuthority: 60,
  overallMarketState: 'range_bound' as OverallMarketState, transition: false,
  perTimeframe: {}, contributors: [], signals: [], warnings: [], ...o,
});

const STAGES = ['accumulation', 'breakout', 'confirmation', 'trend_establishment', 'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal', 'range'];

describe('computeTrendLifecycle — real M0→M6 pipeline', () => {
  const build = (candlesByTf: Partial<Record<Timeframe, Candle[]>>, previousStage?: Parameters<typeof computeTrendLifecycle>[2]) => {
    const snapshots = buildTimeframeSnapshots(candlesByTf);
    const hierarchy = computeTimeframeHierarchy(snapshots);
    return computeTrendLifecycle(snapshots, hierarchy, previousStage);
  };

  it('well-formed result on real candles', () => {
    const r = build({ '1d': series(260, 100, 0.6), '4h': series(260, 100, 0.5), '1h': series(260, 100, 0.4) });
    expect(r.schemaVersion).toBe(1);
    expect(STAGES).toContain(r.stage);
    expect(r.stageConfidence).toBeGreaterThanOrEqual(0);
    expect(r.stageConfidence).toBeLessThanOrEqual(100);
    expect(r.nextStageConfidence).toBeGreaterThanOrEqual(0);
    expect(r.nextStageConfidence).toBeLessThanOrEqual(100);
    expect(Object.keys(r.perTimeframe)).toEqual(['1d', '4h', '1h']);
    expect(r.expectation.expected).toBeDefined();
  });

  it('previousStage flows into progression', () => {
    const r = build({ '1d': series(260, 100, 0.6) }, 'accumulation');
    expect(r.progression.previous).toBe('accumulation');
    expect(r.progression.current).toBe(r.stage);
  });

  it('empty candles → graceful safe result, no throw', () => {
    expect(() => build({})).not.toThrow();
    const r = build({});
    expect(r.schemaVersion).toBe(1);
    expect(STAGES).toContain(r.stage);
    expect(r.perTimeframe).toEqual({});
  });

  it('is deterministic', () => {
    const c = { '1d': series(200, 200, -0.5), '1h': series(200, 200, -0.4) };
    expect(build(c)).toEqual(build(c));
  });
});

describe('computeTrendLifecycle — invalidated stage discounts nextStageConfidence', () => {
  it('invalidation strictly lowers nextStageConfidence below stageConfidence', () => {
    const snapshots = [snap({ timeframe: '1d', bias: 'bullish', confidence: 10, regime: 'trending_up' })];
    const hierarchy = hier({ controller: '1d', htfBias: 'bullish' });
    const r = computeTrendLifecycle(snapshots, hierarchy);
    expect(r.invalidation.invalidated).toBe(true);
    expect(r.nextStageConfidence).toBeLessThan(r.stageConfidence);
  });
});
