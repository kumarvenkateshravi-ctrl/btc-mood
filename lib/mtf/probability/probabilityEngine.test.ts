import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import type { HierarchyResult, OverallMarketState } from '../timeframe/timeframeTypes';
import { buildTimeframeSnapshots } from '../timeframe/snapshots';
import { computeTimeframeHierarchy } from '../timeframe/hierarchy';
import { computeTrendLifecycle } from '../lifecycle/lifecycleEngine';
import { priorsFor } from './priors';
import { computeProbability } from './probabilityEngine';

const series = (n: number, base: number, step: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return { time: i * 300, open: o, high: Math.max(o, close) + 1, low: Math.min(o, close) - 1, close, volume: 1000 + (i % 5) * 80 };
  });

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

/** Spec-frozen bucket map, duplicated here as a freeze guard for reconstruction. */
const BUCKET: Record<TrendStage, string> = {
  breakout: 'expansion', confirmation: 'continuation', trend_establishment: 'continuation',
  continuation: 'continuation', healthy_pullback: 'pullback', exhaustion: 'reversal',
  distribution: 'reversal', reversal: 'reversal', range: 'range', accumulation: 'range',
};

describe('computeProbability — controlled golden (neutral inputs)', () => {
  const r = computeProbability(lc({}), hier({}));

  it('metadata: prior calibration, model version, sample size', () => {
    expect(r.schemaVersion).toBe(1);
    expect(r.calibration).toBe('prior');
    expect(r.modelVersion).toBe('1.0');
    expect(r.sampleSize).toBe(0);
    expect(r.confidenceInterval).toBeUndefined();
  });

  it('layers carry the bare priors', () => {
    expect(r.stageTransitions.find((t) => t.outcome === 'advance')!.probability).toBeCloseTo(0.45, 4);
    expect(r.directional.find((d) => d.direction === 'sideways')!.probability).toBeCloseTo(0.3333, 3);
    // buckets: pullback .45 (advance→healthy_pullback), continuation .45 (stay+regress), reversal .10
    expect(r.marketOutcomes.find((o) => o.outcome === 'pullback')!.probability).toBeCloseTo(0.45, 3);
    expect(r.marketOutcomes.find((o) => o.outcome === 'continuation')!.probability).toBeCloseTo(0.45, 3);
    expect(r.marketOutcomes.find((o) => o.outcome === 'reversal')!.probability).toBeCloseTo(0.10, 3);
  });

  it('dominants + opportunity + honesty signal', () => {
    expect(r.dominantTransition.outcome).toBe('advance');
    expect(r.mostLikelyOutcome.probability).toBeCloseTo(0.45, 3);
    expect(r.opportunity).toEqual({ score: 40, grade: 'D' }); // round(100·(0.6·.45 + 0.4·⅓))
    expect(r.signals.map((s) => s.code)).toContain('PROB_MODEL_PRIORS');
    expect(r.warnings.map((w) => w.code)).not.toContain('PROB_UNCERTAIN');
  });
});

describe('computeProbability — real M0→M7 pipeline', () => {
  const build = (candlesByTf: Partial<Record<Timeframe, Candle[]>>) => {
    const snapshots = buildTimeframeSnapshots(candlesByTf);
    const hierarchy = computeTimeframeHierarchy(snapshots);
    const lifecycle = computeTrendLifecycle(snapshots, hierarchy);
    return { lifecycle, r: computeProbability(lifecycle, hierarchy) };
  };

  it('well-formed: Σ tolerances, dominants = argmax, honesty signal', () => {
    const { r } = build({ '1d': series(260, 100, 0.6), '4h': series(260, 100, 0.5), '1h': series(260, 100, 0.4) });
    for (const layer of [r.stageTransitions, r.directional, r.marketOutcomes] as const) {
      const sum = (layer as Array<{ probability: number }>).reduce((s, x) => s + x.probability, 0);
      expect(sum).toBeGreaterThanOrEqual(0.99);
      expect(sum).toBeLessThanOrEqual(1.01);
    }
    expect(r.dominantTransition.probability).toBe(Math.max(...r.stageTransitions.map((t) => t.probability)));
    expect(r.dominantDirection.probability).toBe(Math.max(...r.directional.map((d) => d.probability)));
    expect(r.mostLikelyOutcome.probability).toBe(Math.max(...r.marketOutcomes.map((o) => o.probability)));
    expect(r.signals.map((s) => s.code)).toContain('PROB_MODEL_PRIORS');
  });

  it('audit reconstruction across all three layers', () => {
    const { lifecycle, r } = build({ '1d': series(260, 100, 0.6), '1h': series(260, 100, 0.4) });
    // Layer 1: priors × factors / Z
    const t = { ...priorsFor(lifecycle.stage) } as Record<string, number>;
    for (const c of r.contributors.filter((x) => x.layer === 'transition')) t[c.outcome] *= c.factor;
    const zt = Object.values(t).reduce((s, w) => s + w, 0);
    for (const x of r.stageTransitions) expect(x.probability).toBeCloseTo(t[x.outcome] / zt, 3);
    // Layer 2: ⅓ priors × factors / Z
    const d: Record<string, number> = { bullish: 1 / 3, bearish: 1 / 3, sideways: 1 / 3 };
    for (const c of r.contributors.filter((x) => x.layer === 'directional')) d[c.outcome] *= c.factor;
    const zd = Object.values(d).reduce((s, w) => s + w, 0);
    for (const x of r.directional) expect(x.probability).toBeCloseTo(d[x.direction] / zd, 3);
    // Layer 3: bucketed transition mass × factors / Z (freeze-guard bucket map)
    const fromBreakout = lifecycle.stage === 'breakout' || lifecycle.stage === 'confirmation';
    const o: Record<string, number> = {};
    for (const tr of r.stageTransitions) {
      if (tr.probability <= 0) continue;
      const bucket = fromBreakout && (tr.outcome === 'regress' || tr.outcome === 'break') ? 'false_breakout' : BUCKET[tr.stage];
      o[bucket] = (o[bucket] ?? 0) + tr.probability;
    }
    for (const c of r.contributors.filter((x) => x.layer === 'outcome')) o[c.outcome] *= c.factor;
    const zo = Object.values(o).reduce((s, w) => s + w, 0);
    for (const x of r.marketOutcomes) expect(x.probability).toBeCloseTo(o[x.outcome] / zo, 2);
  });

  it('empty candles → safe result, no throw', () => {
    expect(() => build({})).not.toThrow();
    const { r } = build({});
    expect(r.calibration).toBe('prior');
    expect(r.marketOutcomes.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const c = { '1d': series(200, 200, -0.5), '1h': series(200, 200, -0.4) };
    expect(build(c).r).toEqual(build(c).r);
  });
});
