// M6 — Trend Lifecycle orchestrator. One pure function composing the stage
// classifier, expectation, progression, invalidation, and strength engines
// around the CONTROLLER timeframe (headline), plus a coarse per-TF stage map.
// Never recomputes M1–M5. Spec: docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md

import { clamp } from '../indicators/shared';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult, TrendStage } from './lifecycleTypes';
import { LIFECYCLE_THRESHOLDS } from './config';
import { classifyStage } from './stage';
import { expectNext } from './expectation';
import { progress } from './progression';
import { checkInvalidation } from './invalidation';
import { lifecycleStrength } from './strength';
import { explainLifecycle } from './explanation';

/** Safe neutral fallback when the controller TF has no snapshot (e.g. empty candles). */
const emptySnapshot = (timeframe: TimeframeSnapshot['timeframe']): TimeframeSnapshot => ({
  timeframe, bias: 'neutral', agreement: 0, conflict: 0, confidence: 0,
  regime: 'ranging', regimeClarity: 0, trendFreshness: 0, momentumExhaustion: 0,
});

export function computeTrendLifecycle(
  snapshots: TimeframeSnapshot[],
  hierarchy: HierarchyResult,
  previousStage?: TrendStage,
): TrendLifecycleResult {
  const controllerSnap = snapshots.find((s) => s.timeframe === hierarchy.controller) ?? emptySnapshot(hierarchy.controller);

  const { stage, direction, stageConfidence } = classifyStage(controllerSnap, hierarchy);
  const progression = progress(previousStage ?? null, stage);
  const expectation = expectNext(stage, controllerSnap.momentumExhaustion);
  const invalidation = checkInvalidation(stage, controllerSnap, hierarchy);
  const strength = lifecycleStrength(stage, controllerSnap, hierarchy);
  const nextStageConfidence = Math.round(clamp(
    stageConfidence - (invalidation.invalidated ? LIFECYCLE_THRESHOLDS.invalidationPenalty : 0), 0, 100,
  ));

  const perTimeframe: TrendLifecycleResult['perTimeframe'] = {};
  for (const s of snapshots) {
    const c = classifyStage(s, hierarchy);
    perTimeframe[s.timeframe] = { stage: c.stage, direction: c.direction };
  }

  const { signals, warnings } = explainLifecycle({
    timeframe: controllerSnap.timeframe, stage, invalidation,
    overallMarketState: hierarchy.overallMarketState, exhaustion: controllerSnap.momentumExhaustion,
  });

  return {
    schemaVersion: 1,
    timeframe: controllerSnap.timeframe,
    stage,
    direction,
    lifecycleStrength: strength,
    freshness: controllerSnap.trendFreshness,
    exhaustion: controllerSnap.momentumExhaustion,
    stageConfidence,
    nextStageConfidence,
    progression,
    expectation,
    invalidation,
    perTimeframe,
    signals,
    warnings,
  };
}
