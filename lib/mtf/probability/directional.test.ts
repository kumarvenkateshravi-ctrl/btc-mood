import { describe, expect, it } from 'vitest';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import { directionalProbabilities } from './directional';

const lc = (o: Partial<TrendLifecycleResult>): TrendLifecycleResult => ({
  schemaVersion: 1, timeframe: '1d', stage: 'trend_establishment', direction: 'neutral',
  lifecycleStrength: 50, freshness: 50, exhaustion: 0, stageConfidence: 50, nextStageConfidence: 50,
  progression: { previous: null, current: 'trend_establishment', trajectory: 'advancing' },
  expectation: { expected: 'healthy_pullback', rationale: 'x' },
  invalidation: { invalidated: false, condition: null },
  perTimeframe: {}, signals: [], warnings: [],
  ...o,
});
const hier = (o: Partial<HierarchyResult>): HierarchyResult => ({
  schemaVersion: 1, htfBias: 'neutral', alignment: 0, conflict: 0, controller: '1d', controllerAuthority: 50,
  overallMarketState: 'range_bound' as OverallMarketState, transition: false,
  perTimeframe: {}, contributors: [], signals: [], warnings: [],
  ...o,
});
const p = (r: ReturnType<typeof directionalProbabilities>, direction: string) =>
  r.distribution.find((d) => d.direction === direction)!.probability;

describe('directionalProbabilities', () => {
  it('neutral everything → ~⅓ each, no contributors', () => {
    const r = directionalProbabilities(lc({}), hier({}));
    expect(p(r, 'bullish')).toBeCloseTo(0.3333, 3);
    expect(p(r, 'bearish')).toBeCloseTo(0.3333, 3);
    expect(p(r, 'sideways')).toBeCloseTo(0.3333, 3);
    expect(r.contributors).toEqual([]);
  });

  it('aligned bullish stack → bullish dominant (hand-computed)', () => {
    const r = directionalProbabilities(
      lc({ direction: 'bullish', lifecycleStrength: 70 }),
      hier({ htfBias: 'bullish', alignment: 80, conflict: 10 }),
    );
    // bull ⅓·1.8·1.35=0.81 · side ⅓·1.1=0.3667 · bear ⅓ → Z=1.51
    expect(p(r, 'bullish')).toBeCloseTo(0.5364, 3);
    expect(p(r, 'bearish')).toBeCloseTo(0.2208, 3);
    expect(p(r, 'sideways')).toBeCloseTo(0.2428, 3);
  });

  it('high conflict boosts sideways', () => {
    const r = directionalProbabilities(lc({}), hier({ conflict: 80 }));
    expect(p(r, 'sideways')).toBeGreaterThan(p(r, 'bullish'));
  });

  it('range-family stage boosts sideways', () => {
    for (const stage of ['range', 'accumulation', 'distribution'] as const) {
      const r = directionalProbabilities(lc({ stage }), hier({}));
      expect(p(r, 'sideways')).toBeGreaterThan(p(r, 'bullish'));
    }
  });

  it('Σ tolerance + audit reconstruction', () => {
    const r = directionalProbabilities(
      lc({ direction: 'bearish', lifecycleStrength: 60, stage: 'distribution' }),
      hier({ htfBias: 'bearish', alignment: 70, conflict: 40 }),
    );
    const sum = r.distribution.reduce((s, d) => s + d.probability, 0);
    expect(sum).toBeGreaterThanOrEqual(0.99);
    expect(sum).toBeLessThanOrEqual(1.01);
    const raw: Record<string, number> = { bullish: 1 / 3, bearish: 1 / 3, sideways: 1 / 3 };
    for (const c of r.contributors) raw[c.outcome] *= c.factor;
    const z = Object.values(raw).reduce((s, w) => s + w, 0);
    for (const d of r.distribution) expect(d.probability).toBeCloseTo(raw[d.direction] / z, 3);
  });

  it('is deterministic', () => {
    const a = [lc({ direction: 'bullish' }), hier({ htfBias: 'bullish', alignment: 50 })] as const;
    expect(directionalProbabilities(...a)).toEqual(directionalProbabilities(...a));
  });
});
