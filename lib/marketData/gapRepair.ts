import type { Candle, Timeframe } from '../types';
import {
  mergeRestCandles,
  resolveCandleGap,
  timeframeIntervalSeconds,
  type CandleGap,
  type CandleMergeState,
} from './candleMerge';

export const MAX_GAP_REPAIR_CANDLES = 1_000;

export interface GapRepairPlan {
  valid: boolean;
  timeframe: Timeframe;
  gap: CandleGap;
  expectedOpenTimes: readonly number[];
  startTimeMs: number;
  endTimeMs: number;
  limit: number;
  reason?: 'invalid_gap' | 'too_large';
}

export interface GapRepairResult {
  ok: boolean;
  state: CandleMergeState;
  reason?: 'invalid_gap' | 'too_large' | 'incomplete' | 'merge_rejected';
}

/** Builds the exact bounded REST request needed to fill one detected hole. */
export function planGapRepair(timeframe: Timeframe, gap: CandleGap): GapRepairPlan {
  const interval = timeframeIntervalSeconds(timeframe);
  const expectedOpenTimes: number[] = [];
  for (let time = gap.fromOpenTime + interval; time < gap.toOpenTime; time += interval) {
    expectedOpenTimes.push(time);
    if (expectedOpenTimes.length > MAX_GAP_REPAIR_CANDLES) {
      return {
        valid: false,
        timeframe,
        gap,
        expectedOpenTimes: [],
        startTimeMs: 0,
        endTimeMs: 0,
        limit: 0,
        reason: 'too_large',
      };
    }
  }
  if (expectedOpenTimes.length === 0 || expectedOpenTimes.length !== gap.missingIntervals) {
    return {
      valid: false,
      timeframe,
      gap,
      expectedOpenTimes: [],
      startTimeMs: 0,
      endTimeMs: 0,
      limit: 0,
      reason: 'invalid_gap',
    };
  }
  return {
    valid: true,
    timeframe,
    gap,
    expectedOpenTimes,
    startTimeMs: expectedOpenTimes[0] * 1_000,
    endTimeMs: gap.toOpenTime * 1_000,
    limit: expectedOpenTimes.length,
  };
}

/**
 * Validates exact timeframe continuity before invoking canonical REST repair.
 * Any partial response leaves the original state (and its non-live gap) intact.
 */
export function applyValidatedGapRepair(
  state: CandleMergeState,
  plan: GapRepairPlan,
  returned: readonly Candle[],
  receivedAtMs: number,
): GapRepairResult {
  if (!plan.valid) return { ok: false, state, reason: plan.reason };
  const byTime = new Map<number, Candle>();
  const expected = new Set(plan.expectedOpenTimes);
  for (const candle of returned) {
    if (expected.has(candle.time)) byTime.set(candle.time, candle);
  }
  const ordered = plan.expectedOpenTimes.map((time) => byTime.get(time));
  if (ordered.some((candle) => candle == null)) return { ok: false, state, reason: 'incomplete' };

  const merged = mergeRestCandles(state, ordered as Candle[], {
    receivedAtMs,
    allowFinalizedRepair: true,
  });
  if (!merged.accepted) return { ok: false, state, reason: 'merge_rejected' };
  const repaired = resolveCandleGap(merged.state, plan.gap);
  const repairedTimes = new Set(repaired.candles.map((candle) => candle.time));
  if (!plan.expectedOpenTimes.every((time) => repairedTimes.has(time))) {
    return { ok: false, state, reason: 'incomplete' };
  }
  return { ok: true, state: repaired };
}
