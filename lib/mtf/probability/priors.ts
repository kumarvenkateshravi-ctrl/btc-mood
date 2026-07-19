// M7 — Transition priors. THE calibration swap point: today these are
// conservative model priors ('prior' calibration); when replay/backtesting later
// measures real stage-transition frequencies, an empirical matrix replaces these
// values (and calibration/sampleSize/modelVersion report it) with ZERO contract
// change. Conservative defaults; tuned later; API stable.
// Spec §Config / Law 3.

import type { TrendStage } from '../lifecycle/lifecycleTypes';
import type { TransitionOutcome } from './probabilityTypes';

export const PROBABILITY_MODEL_VERSION = '1.0';

/** Base prior weights over what any stage does next. Sums to 1. */
export const TRANSITION_PRIORS: Record<TransitionOutcome, number> = {
  advance: 0.45, stay: 0.30, regress: 0.15, break: 0.10,
};

/** Per-stage overrides (merged over the base; each merged set sums to 1). */
export const TRANSITION_PRIOR_OVERRIDES: Partial<Record<TrendStage, Partial<Record<TransitionOutcome, number>>>> = {
  exhaustion: { advance: 0.55, stay: 0.20, regress: 0.10, break: 0.15 },   // exhausted trends roll forward
  reversal: { advance: 0.50, stay: 0.25, regress: 0.10, break: 0.15 },
  range: { advance: 0.35, stay: 0.45, regress: 0.05, break: 0.15 },        // ranges persist
};

/** Effective priors for a stage: base merged with its override. */
export function priorsFor(stage: TrendStage): Record<TransitionOutcome, number> {
  return { ...TRANSITION_PRIORS, ...TRANSITION_PRIOR_OVERRIDES[stage] };
}
