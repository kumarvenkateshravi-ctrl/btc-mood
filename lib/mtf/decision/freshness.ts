// M9 — decision freshness. Tracks (client-side, forward-only) how long the
// CURRENT action has been the Board/M9's call, plus a short rolling history of
// prior actions. Bar-based (not wall-clock), matching the MA-FVG signal card's
// freshness model (lib/indicators/maFvg/signals.ts) for UI consistency —
// duplicated rather than imported, to keep lib/mtf/decision/ independent of a
// specific chart indicator module.
//
// HONESTY NOTE: unlike MA-FVG (which cheaply re-scans full candle history for
// its single lightweight composite), retroactively recomputing the Board +
// M0-M9 stack per historical bar is expensive (indicator-tick-perf) — this
// tracker only knows what it has personally observed since the hook mounted.
// `since`/`recent` start empty on a fresh page load and fill in as bars close.

import type { Candle } from '../../types';
import type { TradeAction } from './decisionTypes';

export const DECISION_FRESHNESS = { activeMaxBars: 5, agingMaxBars: 20 } as const;
export type DecisionFreshness = 'active' | 'aging' | 'stale';

export function decisionFreshnessOf(barsAgo: number): DecisionFreshness {
  if (barsAgo <= DECISION_FRESHNESS.activeMaxBars) return 'active';
  if (barsAgo <= DECISION_FRESHNESS.agingMaxBars) return 'aging';
  return 'stale';
}

export interface DecisionHistoryEntry {
  action: TradeAction;
  barTime: number;
}

export interface DecisionTracker {
  action: TradeAction;
  since: number;
  /** Prior actions, most-recent-first, capped at 5. */
  history: DecisionHistoryEntry[];
}

/** Pure step function (testable, no React): advance the tracker given the
 *  latest action + the bar time it was computed from. Returns the SAME
 *  object reference when nothing changed (safe as a useState updater result —
 *  React bails out of re-rendering on an identical reference). */
export function advanceTracker(
  prev: DecisionTracker | null,
  action: TradeAction,
  barTime: number,
): DecisionTracker {
  if (prev && prev.action === action) return prev;
  const history = prev ? [{ action: prev.action, barTime: prev.since }, ...prev.history].slice(0, 5) : [];
  return { action, since: barTime, history };
}

/** How many closed bars on `execArr` have elapsed since `sinceTime`. */
export function barsAgoOf(execArr: Candle[], sinceTime: number): number {
  const lastClosedIndex = execArr.length - 2; // last bar is still forming
  let count = 0;
  for (let i = lastClosedIndex; i >= 0 && execArr[i].time > sinceTime; i--) count++;
  return count;
}
