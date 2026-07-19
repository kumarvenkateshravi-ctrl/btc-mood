import { describe, expect, it } from 'vitest';
import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import { transitionProbabilities } from './transitions';

const lc = (o: Partial<TrendLifecycleResult>): TrendLifecycleResult => ({
  schemaVersion: 1, timeframe: '1d', stage: 'trend_establishment', direction: 'bullish',
  lifecycleStrength: 50, freshness: 50, exhaustion: 0, stageConfidence: 50, nextStageConfidence: 50,
  progression: { previous: null, current: 'trend_establishment', trajectory: 'advancing' },
  expectation: { expected: 'healthy_pullback', rationale: 'x' },
  invalidation: { invalidated: false, condition: null },
  perTimeframe: {}, signals: [], warnings: [],
  ...o,
});
const p = (r: ReturnType<typeof transitionProbabilities>, outcome: string) =>
  r.distribution.find((d) => d.outcome === outcome)!;

describe('transitionProbabilities', () => {
  it('neutral lifecycle → bare priors, no contributors', () => {
    const r = transitionProbabilities(lc({}));
    expect(p(r, 'advance').probability).toBeCloseTo(0.45, 4);
    expect(p(r, 'stay').probability).toBeCloseTo(0.30, 4);
    expect(p(r, 'regress').probability).toBeCloseTo(0.15, 4);
    expect(p(r, 'break').probability).toBeCloseTo(0.10, 4);
    expect(r.contributors).toEqual([]);
  });

  it('target stages: advance→expected, stay→current, regress→cycle[i−1], break→reversal', () => {
    const r = transitionProbabilities(lc({}));   // trend_establishment, expected healthy_pullback
    expect(p(r, 'advance').stage).toBe('healthy_pullback');
    expect(p(r, 'stay').stage).toBe('trend_establishment');
    expect(p(r, 'regress').stage).toBe('confirmation');
    expect(p(r, 'break').stage).toBe('reversal');
  });

  it('off-cycle/first stage regress target → range', () => {
    const range = transitionProbabilities(lc({ stage: 'range', expectation: { expected: 'breakout', rationale: 'x' } }));
    expect(p(range, 'regress').stage).toBe('range');
    const accum = transitionProbabilities(lc({ stage: 'accumulation', expectation: { expected: 'breakout', rationale: 'x' } }));
    expect(p(accum, 'regress').stage).toBe('range');
  });

  it('high nextStageConfidence sharpens advance (hand-computed)', () => {
    const r = transitionProbabilities(lc({ nextStageConfidence: 90 }));
    // advance ×(1 + 0.8·40/100)=×1.32 → .594; total 1.144 → .5192
    expect(p(r, 'advance').probability).toBeCloseTo(0.5192, 3);
    expect(r.contributors).toEqual([{ layer: 'transition', outcome: 'advance', source: 'nextStageConfidence', factor: 1.32 }]);
  });

  it('invalidation shifts mass from advance to regress+break (hand-computed)', () => {
    const r = transitionProbabilities(lc({ invalidation: { invalidated: true, condition: 'bias flip' } }));
    // advance .225, stay .30, regress .225, break .15 → /0.9
    expect(p(r, 'advance').probability).toBeCloseTo(0.25, 4);
    expect(p(r, 'stay').probability).toBeCloseTo(0.3333, 3);
    expect(p(r, 'regress').probability).toBeCloseTo(0.25, 4);
    expect(p(r, 'break').probability).toBeCloseTo(0.1667, 3);
  });

  it('trajectory regressing boosts regress', () => {
    const r = transitionProbabilities(lc({ progression: { previous: 'continuation', current: 'trend_establishment', trajectory: 'regressing' } }));
    expect(p(r, 'regress').probability).toBeGreaterThan(0.15);
  });

  it('exhaustion ≥ 70 boosts break; below threshold does not', () => {
    expect(p(transitionProbabilities(lc({ exhaustion: 85 })), 'break').probability).toBeGreaterThan(0.10);
    expect(p(transitionProbabilities(lc({ exhaustion: 60 })), 'break').probability).toBeCloseTo(0.10, 4);
  });

  it('stage overrides apply (range priors)', () => {
    const r = transitionProbabilities(lc({ stage: 'range', expectation: { expected: 'breakout', rationale: 'x' } }));
    expect(p(r, 'stay').probability).toBeCloseTo(0.45, 4);
  });

  it('Σ within tolerance + audit reconstruction from contributors', () => {
    const r = transitionProbabilities(lc({ nextStageConfidence: 80, lifecycleStrength: 70, freshness: 30, exhaustion: 75 }));
    const sum = r.distribution.reduce((s, d) => s + d.probability, 0);
    expect(sum).toBeGreaterThanOrEqual(0.99);
    expect(sum).toBeLessThanOrEqual(1.01);
    // reconstruct: prior × Π(factors) / Z
    const priors: Record<string, number> = { advance: 0.45, stay: 0.30, regress: 0.15, break: 0.10 };
    const raw: Record<string, number> = { ...priors };
    for (const c of r.contributors) raw[c.outcome] *= c.factor;
    const z = Object.values(raw).reduce((s, w) => s + w, 0);
    for (const d of r.distribution) expect(d.probability).toBeCloseTo(raw[d.outcome] / z, 3);
  });

  it('is deterministic', () => {
    const args = lc({ nextStageConfidence: 72, exhaustion: 71 });
    expect(transitionProbabilities(args)).toEqual(transitionProbabilities(args));
  });
});
