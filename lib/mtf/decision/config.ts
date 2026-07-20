// M9 — decision configuration. Single source for every threshold and multiple;
// no magic numbers in logic. All values: conservative default; tuned later; API stable.

import type { RiskTier } from './decisionTypes';

/** Conservative defaults; tuned later; API stable. */
export const DECISION_CONFIG = {
  /** ATR length (RMA of true range, TradingView-faithful). */
  atrLength: 14,
  /** k bars each side required to confirm a fractal swing. */
  swingConfirmBars: 2,
  /** Entry-zone width as an ATR multiple, anchored at the swing. */
  entryZoneAtrMult: 0.25,
  /** Stop distance beyond the anchoring swing, as an ATR multiple. */
  stopAtrMult: 1.0,
  /** Measured-move target, in R. */
  targetRR: 2.0,
  /** Gate rung 7: minimum RR to the first target. */
  minRR: 1.5,
  /** SMC entry snap: max gap between zone and object band, as an ATR multiple. */
  smcSnapToleranceAtrMult: 0.5,
  /** SMC stop extension: max distance a pool may sit beyond the stop, as an ATR multiple. */
  stopExtendMaxAtrMult: 0.75,
  /** SMC stop extension: buffer placed past the pool, as an ATR multiple. */
  stopBufferAtrMult: 0.1,
  /** Gate rung 5 floor (covers atrLength + swing confirmation). */
  minCandles: 20,
};

/** While M7 runs on model priors, no environment justifies full risk. */
export const PRIOR_TIER_CAP: RiskTier = 'half';
