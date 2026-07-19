// M4 — Market Confidence configuration. Single source for every weight and
// threshold; no magic numbers live in engine logic. Named category knowledge
// (relaxed Rule 6) is declared HERE, not branched in code.
// Spec: docs/superpowers/specs/2026-07-19-m4-market-confidence-engine-design.md

/** Pillar blend (the base). Sums to 1. Conservative default; tuned later; API stable. */
export const CONFIDENCE_WEIGHTS = { indicator: 0.30, category: 0.35, agreement: 0.35 } as const;

/** Category-aggregation weighting — DIRECTIONAL categories only (quality/volatility are
 *  non-directional trust modifiers handled as penalties). Weights sum to 1. Tunable; API stable. */
export const CATEGORY_CONFIDENCE_FACTORS: Record<string, { weight: number; minConfidence?: number; minStrength?: number }> = {
  trend: { weight: 0.30, minConfidence: 60 },
  momentum: { weight: 0.25 },
  volume: { weight: 0.20 },
  participation: { weight: 0.25, minStrength: 55 },
};

/** Confidence → state bands (≥). Conservative default; tuned later; API stable. */
export const CONFIDENCE_THRESHOLDS = { veryHigh: 80, high: 65, medium: 45, low: 30 } as const;

/** Orthogonal positive: data-volume bonus (NOT confidence level). Tunable; API stable. */
export const CONFIDENCE_EVIDENCE = { completeness: 8 } as const;

/** Orthogonal reductions — none represented in the base. Tunable; API stable. */
export const CONFIDENCE_PENALTIES = { conflict: 15, layerMismatch: 10, quality: 12, volatility: 10, limitingFactor: 0.4 } as const;
