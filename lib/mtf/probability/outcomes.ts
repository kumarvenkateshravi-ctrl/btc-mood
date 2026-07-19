// M7 — Layer 3: market-outcome probabilities — the trader-facing layer. Each
// transition's mass lands in the bucket of its TARGET stage (with a false-
// breakout override for regress/break out of breakout/confirmation stages),
// then three directional modulations are applied and the result normalized.
// Modulation factors are the layer's contributors; the bucketed transition mass
// is the layer's prior (audit identity holds per layer). Spec §Layer 3.

import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import type {
  DirectionalProbability, MarketOutcome, OutcomeProbability, ProbabilityContributor, TransitionProbability,
} from './probabilityTypes';
import { PROB_FACTORS } from './config';

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Which trader outcome a target stage evidences. */
const BUCKET: Record<TrendStage, MarketOutcome> = {
  breakout: 'expansion',
  confirmation: 'continuation', trend_establishment: 'continuation', continuation: 'continuation',
  healthy_pullback: 'pullback',
  exhaustion: 'reversal', distribution: 'reversal', reversal: 'reversal',
  range: 'range', accumulation: 'range',
};

export function marketOutcomeProbabilities(
  transitions: TransitionProbability[],
  directional: DirectionalProbability[],
  lifecycle: TrendLifecycleResult,
): { distribution: OutcomeProbability[]; contributors: ProbabilityContributor[] } {
  const F = PROB_FACTORS;
  const fromBreakoutFamily = lifecycle.stage === 'breakout' || lifecycle.stage === 'confirmation';

  // --- bucket the transition mass (this layer's prior) ---
  const weights = new Map<MarketOutcome, number>();
  for (const tr of transitions) {
    if (tr.probability <= 0) continue;
    const bucket: MarketOutcome =
      fromBreakoutFamily && (tr.outcome === 'regress' || tr.outcome === 'break') ? 'false_breakout' : BUCKET[tr.stage];
    weights.set(bucket, (weights.get(bucket) ?? 0) + tr.probability);
  }

  // --- directional modulations (recorded as contributors; only on buckets with mass) ---
  const contributors: ProbabilityContributor[] = [];
  const pDir = (d: string) => directional.find((x) => x.direction === d)?.probability ?? 0;
  const apply = (outcome: MarketOutcome, source: string, factor: number) => {
    const f = round4(factor);
    if (f === 1 || !weights.has(outcome)) return;
    weights.set(outcome, weights.get(outcome)! * f);
    contributors.push({ layer: 'outcome', outcome, source, factor: f });
  };
  const biasDir = lifecycle.direction === 'bullish' || lifecycle.direction === 'bearish' ? lifecycle.direction : null;
  if (biasDir) {
    apply('continuation', 'direction·bias', 1 + F.outDirection * pDir(biasDir));
    apply('reversal', 'direction·opposite', 1 + F.outDirection * pDir(biasDir === 'bullish' ? 'bearish' : 'bullish'));
  }
  apply('range', 'direction·sideways', 1 + F.outDirection * pDir('sideways'));

  // --- normalize; empty buckets omitted; sorted by probability desc for stable display ---
  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  const distribution = [...weights.entries()]
    .map(([outcome, w]) => ({ outcome, probability: total > 0 ? round4(w / total) : 0 }))
    .sort((a, b) => b.probability - a.probability);
  return { distribution, contributors };
}
