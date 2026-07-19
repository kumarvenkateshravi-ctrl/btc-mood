// M7 — Probability orchestrator. One pure function: transitions → directional →
// market outcomes → opportunity → explanation → ProbabilityResult. Always
// calibration:'prior' in v1 (model estimates, honestly labeled); the empirical
// path replaces priors.ts later with zero contract change. M8 consumes only this.
// Spec: docs/superpowers/specs/2026-07-19-m7-probability-engine-design.md

import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { ProbabilityResult } from './probabilityTypes';
import { PROBABILITY_MODEL_VERSION } from './priors';
import { transitionProbabilities } from './transitions';
import { directionalProbabilities } from './directional';
import { marketOutcomeProbabilities } from './outcomes';
import { opportunityOf } from './opportunity';
import { explainProbability } from './explanation';

const argmax = <T extends { probability: number }>(xs: T[]): T =>
  xs.reduce((m, x) => (x.probability > m.probability ? x : m));

export function computeProbability(
  lifecycle: TrendLifecycleResult,
  hierarchy: HierarchyResult,
): ProbabilityResult {
  const transitions = transitionProbabilities(lifecycle);
  const directional = directionalProbabilities(lifecycle, hierarchy);
  const outcomes = marketOutcomeProbabilities(transitions.distribution, directional.distribution, lifecycle);

  const dominantTransition = argmax(transitions.distribution);
  const dominantDirection = argmax(directional.distribution);
  const mostLikelyOutcome = argmax(outcomes.distribution);

  const calibration = 'prior' as const;
  const { signals, warnings } = explainProbability({ calibration, mostLikelyOutcome, marketOutcomes: outcomes.distribution });

  return {
    schemaVersion: 1,
    calibration,
    modelVersion: PROBABILITY_MODEL_VERSION,
    sampleSize: 0,
    stageTransitions: transitions.distribution,
    directional: directional.distribution,
    marketOutcomes: outcomes.distribution,
    dominantTransition,
    dominantDirection,
    mostLikelyOutcome,
    opportunity: opportunityOf(mostLikelyOutcome, dominantDirection),
    contributors: [...transitions.contributors, ...directional.contributors, ...outcomes.contributors],
    signals,
    warnings,
  };
}
