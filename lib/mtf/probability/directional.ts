// M7 — Layer 2: directional probabilities P(bullish/bearish/sideways). Prior
// ⅓/⅓/⅓ adjusted by named multiplicative factors from the hierarchy (alignment,
// conflict) and lifecycle (direction, strength, range-family stages); every
// factor ≠ 1 recorded as a contributor (audit identity). Spec §Layer 2.

import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { DirectionalProbability, OutcomeDirection, ProbabilityContributor } from './probabilityTypes';
import { PROB_FACTORS } from './config';
import { normalize } from './transitions';

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const RANGE_STAGES = new Set(['range', 'accumulation', 'distribution']);

export function directionalProbabilities(
  lifecycle: TrendLifecycleResult,
  hierarchy: HierarchyResult,
): { distribution: DirectionalProbability[]; contributors: ProbabilityContributor[] } {
  const F = PROB_FACTORS;
  const weights: Record<OutcomeDirection, number> = { bullish: 1 / 3, bearish: 1 / 3, sideways: 1 / 3 };
  const contributors: ProbabilityContributor[] = [];
  const apply = (direction: OutcomeDirection, source: string, factor: number) => {
    const f = round4(factor);
    if (f === 1) return;
    weights[direction] *= f;
    contributors.push({ layer: 'directional', outcome: direction, source, factor: f });
  };

  if (hierarchy.htfBias === 'bullish' || hierarchy.htfBias === 'bearish') {
    apply(hierarchy.htfBias, 'htfBias·alignment', 1 + F.dirAlignment * hierarchy.alignment / 100);
  }
  apply('sideways', 'conflict', 1 + F.dirConflict * hierarchy.conflict / 100);
  if (lifecycle.direction === 'bullish' || lifecycle.direction === 'bearish') {
    apply(lifecycle.direction, 'lifecycle·strength', 1 + F.dirLifecycle * lifecycle.lifecycleStrength / 100);
  }
  if (RANGE_STAGES.has(lifecycle.stage)) apply('sideways', 'rangeStage', 1 + F.dirRangeStage);

  const probs = normalize(weights);
  const distribution = (['bullish', 'bearish', 'sideways'] as OutcomeDirection[])
    .map((direction) => ({ direction, probability: probs[direction] }));
  return { distribution, contributors };
}
