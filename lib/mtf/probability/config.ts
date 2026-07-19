// M7 — Probability configuration. Every adjustment factor and threshold lives
// here; no magic numbers in engine logic. Conservative defaults; tuned later
// against BTC data; API stable. Spec §Config.

/** Multiplicative adjustment factors (applied as ×(1 + f·signal), see spec per layer). */
export const PROB_FACTORS = {
  confSharpen: 0.8,       // advance ×(1 + f·(nextStageConfidence−50)/100)
  invalidation: 0.5,      // invalidated: advance ×(1−f); regress, break ×(1+f)
  trajectoryRegress: 0.4, // trajectory 'regressing': regress ×(1+f)
  exhaustionBreak: 0.6,   // exhaustion ≥ 70: break ×(1 + f·exhaustion/100)
  strengthAdvance: 0.4,   // advance ×(1 + f·(lifecycleStrength−50)/100)
  freshnessStay: 0.3,     // stay ×(1 + f·(freshness−50)/100)
  dirAlignment: 1.0,      // htfBias side ×(1 + f·alignment/100)
  dirConflict: 1.0,       // sideways ×(1 + f·conflict/100)
  dirLifecycle: 0.5,      // lifecycle.direction side ×(1 + f·lifecycleStrength/100)
  dirRangeStage: 0.5,     // stage ∈ {range, accumulation, distribution}: sideways ×(1+f)
  outDirection: 0.5,      // continuation ×(1 + f·P(bias dir)); reversal ×(1 + f·P(opposite)); range ×(1 + f·P(sideways))
} as const;

export const PROB_THRESHOLDS = { highConviction: 0.65, uncertain: 0.40, reversalElevated: 0.25 } as const;

/** Opportunity grade lower bounds on the 0–100 score; D below C. */
export const OPPORTUNITY_GRADES = { A: 80, B: 65, C: 45 } as const;
