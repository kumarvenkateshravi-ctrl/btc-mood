// M6 — Invalidation engine. Deterministic conditions under which the CURRENT
// stage classification is no longer trustworthy. 'confirmation' is checked
// against BOTH the trending-group (confidence/bias) and breakout-group
// (freshness/alignment) conditions since a confirmation can fail either way.
// Spec §Invalidation engine.

import type { Verdict } from '../types';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import type { TrendStage } from './lifecycleTypes';
import { LIFECYCLE_THRESHOLDS } from './config';

const isDir = (v: Verdict): boolean => v === 'bullish' || v === 'bearish';

export function checkInvalidation(
  stage: TrendStage,
  s: TimeframeSnapshot,
  hier: HierarchyResult,
): { invalidated: boolean; condition: string | null } {
  const T = LIFECYCLE_THRESHOLDS;

  if (stage === 'trend_establishment' || stage === 'continuation' || stage === 'confirmation') {
    if (s.confidence < T.weakConfidence) return { invalidated: true, condition: 'confidence collapse' };
    if (isDir(hier.htfBias) && isDir(s.bias) && hier.htfBias !== s.bias) return { invalidated: true, condition: 'bias flip' };
  }
  if (stage === 'breakout' || stage === 'confirmation') {
    if (s.trendFreshness < T.freshMid && hier.alignment < T.alignConfirm) return { invalidated: true, condition: 'false breakout' };
  }
  if (stage === 'healthy_pullback' && hier.overallMarketState === 'reversal_risk') {
    return { invalidated: true, condition: 'pullback failed into reversal' };
  }
  return { invalidated: false, condition: null };
}
