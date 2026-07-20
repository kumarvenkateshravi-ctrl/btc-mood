// M8 — Market Intelligence configuration. Every weight, band, point value, and
// threshold lives here; no magic numbers in engine logic. Conservative defaults;
// tuned later against BTC data; API stable. Spec §Config.

/** Quality blend (non-directional market health). Sums to 1; calm = 100 − conflict. */
export const QUALITY_WEIGHTS = { confidence: 0.30, agreement: 0.25, alignment: 0.20, lifecycleStrength: 0.15, calm: 0.10 } as const;
/** Quality score lower bounds (≥); 'dangerous' below poor. */
export const QUALITY_BANDS = { excellent: 80, good: 65, average: 45, poor: 30 } as const;

/** Market-level opportunity blend (consumes M7's distribution-level opportunity as ONE input). Sums to 1. */
export const OPP_WEIGHTS = { agreement: 0.30, confidence: 0.25, outcomeProb: 0.25, lifecycleStrength: 0.10, m7Opportunity: 0.10 } as const;
/** Grade lower bounds (≥); F below D. */
export const OPP_GRADES = { 'A+': 90, A: 80, B: 65, C: 50, D: 35 } as const;

/** Additive environment-risk points per named factor. */
export const RISK_POINTS = {
  conflict: 25, transition: 15, reversalRisk: 20, weakController: 10,
  lowConfidence: 20, invalidated: 10, priorCalibration: 5, expansionRegime: 10,
} as const;
/** Risk level upper bounds (<); 'extreme' at/above high. */
export const RISK_BANDS = { veryLow: 15, low: 30, medium: 50, high: 70 } as const;

/** Readiness gate minimums (see the four-rung ladder in readiness.ts). */
export const READINESS = { minQuality: 'good', minGrade: 'B', maxRisk: 'medium' } as const;
