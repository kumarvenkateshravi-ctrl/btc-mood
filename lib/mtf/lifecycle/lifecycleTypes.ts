// M6 — Trend Lifecycle contract. Consumes the frozen M5 surface only (TimeframeSnapshot[]
// + HierarchyResult); never recomputes M1–M5. Spec:
// docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';

export type TrendStage =
  | 'accumulation' | 'breakout' | 'confirmation' | 'trend_establishment'
  | 'healthy_pullback' | 'continuation' | 'exhaustion' | 'distribution' | 'reversal' | 'range';

export interface LifecycleSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

export interface TrendLifecycleResult {
  schemaVersion: 1;
  timeframe: Timeframe;
  stage: TrendStage;
  direction: Verdict;
  lifecycleStrength: number;
  freshness: number;
  exhaustion: number;
  /** Confidence in the CURRENT stage classification — NOT a probability. */
  stageConfidence: number;
  /** Confidence in the EXPECTED next stage — NOT a probability (M7 reservation). */
  nextStageConfidence: number;
  progression: { previous: TrendStage | null; current: TrendStage; trajectory: 'advancing' | 'stalling' | 'regressing' };
  expectation: { expected: TrendStage; rationale: string };
  invalidation: { invalidated: boolean; condition: string | null };
  perTimeframe: Partial<Record<Timeframe, { stage: TrendStage; direction: Verdict }>>;
  signals: LifecycleSignal[];
  warnings: LifecycleSignal[];
}

export type ComputeTrendLifecycle = (
  snapshots: TimeframeSnapshot[], hierarchy: HierarchyResult, previousStage?: TrendStage,
) => TrendLifecycleResult;
