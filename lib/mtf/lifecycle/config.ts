// M6 — Trend Lifecycle configuration. Conservative defaults; tuned later; API stable.

import type { TrendStage } from './lifecycleTypes';

export const LIFECYCLE_THRESHOLDS = {
  exhaustHigh: 70, freshHigh: 70, freshMid: 40, alignConfirm: 60, strongTrend: 55, weakConfidence: 40,
  invalidationPenalty: 30,
} as const;

/** Canonical forward order for progression/expectation. 'range' is off-cycle. */
export const CYCLE_ORDER: TrendStage[] = [
  'accumulation', 'breakout', 'confirmation', 'trend_establishment',
  'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal',
];
