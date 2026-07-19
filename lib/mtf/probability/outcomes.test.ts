import { describe, expect, it } from 'vitest';
import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import type { DirectionalProbability, TransitionOutcome, TransitionProbability } from './probabilityTypes';
import { marketOutcomeProbabilities } from './outcomes';

const lc = (o: Partial<TrendLifecycleResult>): TrendLifecycleResult => ({
  schemaVersion: 1, timeframe: '1d', stage: 'trend_establishment', direction: 'neutral',
  lifecycleStrength: 50, freshness: 50, exhaustion: 0, stageConfidence: 50, nextStageConfidence: 50,
  progression: { previous: null, current: 'trend_establishment', trajectory: 'advancing' },
  expectation: { expected: 'healthy_pullback', rationale: 'x' },
  invalidation: { invalidated: false, condition: null },
  perTimeframe: {}, signals: [], warnings: [],
  ...o,
});
const t = (outcome: TransitionOutcome, stage: TrendStage, probability: number): TransitionProbability => ({ outcome, stage, probability });
const dir = (bullish: number, bearish: number, sideways: number): DirectionalProbability[] => [
  { direction: 'bullish', probability: bullish }, { direction: 'bearish', probability: bearish }, { direction: 'sideways', probability: sideways },
];
const p = (r: ReturnType<typeof marketOutcomeProbabilities>, outcome: string) =>
  r.distribution.find((d) => d.outcome === outcome)?.probability;

describe('marketOutcomeProbabilities', () => {
  it('trending targets bucket into continuation (dominant)', () => {
    const r = marketOutcomeProbabilities(
      [t('advance', 'continuation', 0.5), t('stay', 'trend_establishment', 0.3), t('regress', 'confirmation', 0.1), t('break', 'reversal', 0.1)],
      dir(0.6, 0.2, 0.2), lc({ direction: 'bullish' }),
    );
    expect(p(r, 'continuation')).toBeGreaterThan(0.7);
    expect(r.distribution[0]).toBe(r.distribution.reduce((m, d) => (d.probability > m.probability ? d : m)));
  });

  it('healthy_pullback target → pullback bucket; breakout target → expansion', () => {
    const r = marketOutcomeProbabilities(
      [t('advance', 'healthy_pullback', 0.6), t('stay', 'breakout', 0.4)],
      dir(1 / 3, 1 / 3, 1 / 3), lc({}),
    );
    expect(p(r, 'pullback')).toBeCloseTo(0.6, 3);
    expect(p(r, 'expansion')).toBeCloseTo(0.4, 3);
  });

  it('false-breakout override: from breakout/confirmation stages, regress+break mass → false_breakout', () => {
    const r = marketOutcomeProbabilities(
      [t('advance', 'confirmation', 0.5), t('stay', 'breakout', 0.2), t('regress', 'accumulation', 0.2), t('break', 'reversal', 0.1)],
      dir(1 / 3, 1 / 3, 1 / 3), lc({ stage: 'breakout' }),
    );
    expect(p(r, 'false_breakout')).toBeCloseTo(0.3, 3);
    expect(p(r, 'range')).toBeUndefined();      // the regress mass was overridden away
    expect(p(r, 'reversal')).toBeUndefined();   // the break mass was overridden away
  });

  it('directional modulation shifts mass toward reversal (hand-computed)', () => {
    const r = marketOutcomeProbabilities(
      [t('advance', 'continuation', 0.4), t('break', 'reversal', 0.6)],
      dir(0.2, 0.7, 0.1), lc({ direction: 'bullish' }),
    );
    // continuation .4×(1+.5·.2)=.44 · reversal .6×(1+.5·.7)=.81 → Z=1.25
    expect(p(r, 'continuation')).toBeCloseTo(0.352, 3);
    expect(p(r, 'reversal')).toBeCloseTo(0.648, 3);
  });

  it('range/accumulation targets → range bucket, boosted by sideways probability', () => {
    const r = marketOutcomeProbabilities(
      [t('stay', 'range', 0.5), t('regress', 'accumulation', 0.3), t('advance', 'breakout', 0.2)],
      dir(0.1, 0.1, 0.8), lc({ stage: 'range' }),
    );
    expect(p(r, 'range')).toBeGreaterThan(0.7);
  });

  it('zero-mass buckets are omitted; Σ tolerance; audit reconstruction', () => {
    const transitions = [t('advance', 'continuation', 0.7), t('break', 'reversal', 0.3)];
    const d = dir(0.5, 0.3, 0.2);
    const r = marketOutcomeProbabilities(transitions, d, lc({ direction: 'bullish' }));
    expect(r.distribution.map((x) => x.outcome).sort()).toEqual(['continuation', 'reversal']);
    const sum = r.distribution.reduce((s, x) => s + x.probability, 0);
    expect(sum).toBeGreaterThanOrEqual(0.99);
    expect(sum).toBeLessThanOrEqual(1.01);
    const raw: Record<string, number> = { continuation: 0.7, reversal: 0.3 };
    for (const c of r.contributors) raw[c.outcome] *= c.factor;
    const z = Object.values(raw).reduce((s, w) => s + w, 0);
    for (const x of r.distribution) expect(x.probability).toBeCloseTo(raw[x.outcome] / z, 3);
  });
});
