// M-Board — configuration. Single source for every threshold; no magic numbers
// in boardEngine.ts logic.

import type { Timeframe } from '../../types';

export const BOARD_CONFIG = {
  /** Below this cross-TF agreement %, direction collapses to 'no_trade' even
   *  with a clear bias — the floor the old controller-veto bug lacked. */
  minConviction: 55,
  /** trendStrength.score buckets. */
  strengthBuckets: { strong: 60, moderate: 30 },
  /** How much conviction is reduced when the dissenting minority's average
   *  score sits at the extreme opposite pole (0=no penalty at any extremity,
   *  1=agreementPct fully wiped out at max extremity). Applied to raw score
   *  extremity only — deliberately NOT weighted by TF authority/position,
   *  since that per-TF-importance weighting is exactly what caused the
   *  original controller-veto bug. */
  dissentPenaltyWeight: 0.3,
  /** Minimum dissent extremity (0-1) that emits a BOARD_STRONG_DISSENT warning. */
  strongDissentThreshold: 0.5,
} as const;

/** Execution-primary weighting (Arch v2.1, 2026-07-26): this is a 5m EXECUTION
 *  system, so the 5m/15m/30m cluster DECIDES direction & conviction (0.80 of the
 *  weight); the higher 1h/4h/1d TFs are CONTEXT only (0.20) — they can shave
 *  conviction and dent it via the dissent penalty, but can never drag a leaning
 *  execution cluster into 'neutral' the way the old higher-TF-heavy weighting did.
 *  This is the direct fix for the original "higher timeframe controls the lower
 *  timeframe" complaint, now applied to the Board's own direction call (not just
 *  M9's gate). Tunable; deliberately NOT the global lib/multiTimeframe TF_WEIGHT
 *  (that stays higher-TF-heavy for the dashboard/Stack Score consumers). */
export const BOARD_TF_WEIGHTS: Record<Timeframe, number> = {
  '5m': 0.30, '15m': 0.30, '30m': 0.20, '1h': 0.10, '4h': 0.06, '1d': 0.04,
};
