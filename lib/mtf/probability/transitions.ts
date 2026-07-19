// M7 — Layer 1: stage-transition probabilities. Starts from the (swap-point)
// priors and applies named multiplicative factors — every factor ≠ 1 is recorded
// as a contributor so the distribution is reconstructable: final = prior ×
// Π(factors) / Z. Spec §Layer 1.

import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import { CYCLE_ORDER, LIFECYCLE_THRESHOLDS } from '../lifecycle/config';
import type { ProbabilityContributor, TransitionOutcome, TransitionProbability } from './probabilityTypes';
import { priorsFor } from './priors';
import { PROB_FACTORS } from './config';

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Normalize a weight map into probabilities (0–1, 4 dp); all-zero → zeros. */
export function normalize<K extends string>(weights: Record<K, number>): Record<K, number> {
  const total = (Object.values(weights) as number[]).reduce((s, w) => s + w, 0);
  const out = {} as Record<K, number>;
  for (const k of Object.keys(weights) as K[]) out[k] = total > 0 ? round4(weights[k] / total) : 0;
  return out;
}

/** One cycle step back; off-cycle ('range') or the first stage regresses into range. */
function regressTarget(stage: TrendStage): TrendStage {
  const i = CYCLE_ORDER.indexOf(stage);
  return i <= 0 ? 'range' : CYCLE_ORDER[i - 1];
}

export function transitionProbabilities(
  lifecycle: TrendLifecycleResult,
): { distribution: TransitionProbability[]; contributors: ProbabilityContributor[] } {
  const F = PROB_FACTORS;
  const weights = { ...priorsFor(lifecycle.stage) };
  const contributors: ProbabilityContributor[] = [];
  const apply = (outcome: TransitionOutcome, source: string, factor: number) => {
    const f = round4(factor);
    if (f === 1) return;
    weights[outcome] *= f;
    contributors.push({ layer: 'transition', outcome, source, factor: f });
  };

  apply('advance', 'nextStageConfidence', 1 + F.confSharpen * (lifecycle.nextStageConfidence - 50) / 100);
  if (lifecycle.invalidation.invalidated) {
    apply('advance', 'invalidation', 1 - F.invalidation);
    apply('regress', 'invalidation', 1 + F.invalidation);
    apply('break', 'invalidation', 1 + F.invalidation);
  }
  if (lifecycle.progression.trajectory === 'regressing') apply('regress', 'trajectory', 1 + F.trajectoryRegress);
  if (lifecycle.exhaustion >= LIFECYCLE_THRESHOLDS.exhaustHigh) apply('break', 'exhaustion', 1 + F.exhaustionBreak * lifecycle.exhaustion / 100);
  apply('advance', 'lifecycleStrength', 1 + F.strengthAdvance * (lifecycle.lifecycleStrength - 50) / 100);
  apply('stay', 'freshness', 1 + F.freshnessStay * (lifecycle.freshness - 50) / 100);

  const probs = normalize(weights);
  const target: Record<TransitionOutcome, TrendStage> = {
    advance: lifecycle.expectation.expected,
    stay: lifecycle.stage,
    regress: regressTarget(lifecycle.stage),
    break: 'reversal',
  };
  const distribution = (['advance', 'stay', 'regress', 'break'] as TransitionOutcome[])
    .map((outcome) => ({ outcome, stage: target[outcome], probability: probs[outcome] }));
  return { distribution, contributors };
}
