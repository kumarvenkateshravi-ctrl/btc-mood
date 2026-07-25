// M-Board — configuration. Single source for every threshold; no magic numbers
// in boardEngine.ts logic.

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
