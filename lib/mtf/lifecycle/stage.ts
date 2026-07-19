// M6 — Trend Stage classifier. Consumes one TimeframeSnapshot + the HierarchyResult
// (never recomputes M1–M5). oms-derived branches (reversal/pullback/continuation)
// are stack-wide facts, only meaningful for the CONTROLLER timeframe; non-controller
// snapshots fall through to a coarser regime/freshness/exhaustion-only form.
// Spec: docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md

import type { Verdict } from '../types';
import { clamp } from '../indicators/shared';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import type { TrendStage } from './lifecycleTypes';
import { LIFECYCLE_THRESHOLDS } from './config';

export function classifyStage(
  s: TimeframeSnapshot,
  hier: HierarchyResult,
): { stage: TrendStage; direction: Verdict; stageConfidence: number } {
  const T = LIFECYCLE_THRESHOLDS;
  const isController = s.timeframe === hier.controller;
  const oms = hier.overallMarketState;
  const direction = s.bias;
  // Off-controller: hier.alignment/conflict describe the WHOLE stack, not this TF —
  // fall back to confidence-derived proxies (spec's "coarse per-TF form").
  const alignment = isController ? hier.alignment : s.confidence;
  const conflict = isController ? hier.conflict : 100 - s.confidence;

  let stage: TrendStage;
  let marginScore: number;

  if (s.regime === 'compression') {
    if (direction === 'bullish') { stage = 'accumulation'; marginScore = s.regimeClarity; }
    else if (direction === 'bearish') { stage = 'distribution'; marginScore = s.regimeClarity; }
    else { stage = 'range'; marginScore = s.regimeClarity; }
  } else if (s.regime === 'expansion') {
    if (direction !== 'neutral' && s.trendFreshness >= T.freshHigh) { stage = 'breakout'; marginScore = s.trendFreshness; }
    else { stage = 'range'; marginScore = s.regimeClarity; }
  } else if (s.regime === 'ranging') {
    stage = 'range'; marginScore = s.regimeClarity;
  } else {
    // trending_up / trending_down — precedence per spec, oms-branches gated on controller.
    if (isController && oms === 'reversal_risk') { stage = 'reversal'; marginScore = conflict; }
    else if (s.momentumExhaustion >= T.exhaustHigh) { stage = 'exhaustion'; marginScore = s.momentumExhaustion; }
    else if (isController && (oms === 'bullish_pullback' || oms === 'bearish_pullback')) { stage = 'healthy_pullback'; marginScore = alignment; }
    else if (isController && (oms === 'bullish_continuation' || oms === 'bearish_continuation')) { stage = 'continuation'; marginScore = alignment; }
    else if (s.trendFreshness >= T.freshHigh) { stage = 'breakout'; marginScore = s.trendFreshness; }
    else if (s.trendFreshness >= T.freshMid && alignment >= T.alignConfirm) { stage = 'confirmation'; marginScore = (s.trendFreshness + alignment) / 2; }
    else { stage = 'trend_establishment'; marginScore = s.regimeClarity; }
  }

  const stageConfidence = Math.round(clamp(0.5 * marginScore + 0.5 * s.confidence, 0, 100));
  return { stage, direction, stageConfidence };
}
