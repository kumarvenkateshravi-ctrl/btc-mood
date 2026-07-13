// Deep-history planning for Bar Replay practice (option A of the 5-year
// history work). Given a practice start date, decide which timeframes to
// backfill and how far, so a user can replay from years back without
// scrolling through dozens of lazy-load pages by hand.
//
// Policy: the selected TF and everything ABOVE it load to the requested
// date (higher TFs are cheap — 5y of 1d is 2 pages). Intraday TFs carry
// per-TF depth caps so 5 years of 5m (~525k candles) can never blow up
// memory or the indicator stack (tick-perf rule). TFs BELOW the selected
// one are skipped in v1 — replay evaluates the selected ladder upward.

import { TIMEFRAMES, type Timeframe } from '../types';

export const TF_SECONDS: Record<Timeframe, number> = {
  '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
};

/** Max lookback per TF (seconds). Infinity = no cap beyond the request. */
const MAX_DEPTH_S: Record<Timeframe, number> = {
  '5m': 180 * 86400,        // 6 months
  '15m': 2 * 365 * 86400,   // 2 years
  '30m': 3 * 365 * 86400,   // 3 years
  '1h': Infinity,
  '4h': Infinity,
  '1d': Infinity,
};

/** Absolute safety valve regardless of TF (bars per TF). */
export const MAX_BARS_PER_TF = 60_000;

export interface DeepLoadStep {
  tf: Timeframe;
  /** Load pages until history covers this unix-ms time. */
  untilMs: number;
  /** Upper bound on 1000-bar pages this step may fetch. */
  maxPages: number;
}

/**
 * Plan the backfill for practicing from `targetMs`. Returns the selected TF
 * first (the chart the user is staring at fills in first), then higher TFs.
 */
export function planDeepLoad(selectedTf: Timeframe, targetMs: number, nowMs: number): DeepLoadStep[] {
  const startIdx = TIMEFRAMES.indexOf(selectedTf);
  if (startIdx < 0 || targetMs >= nowMs) return [];
  const steps: DeepLoadStep[] = [];
  for (const tf of TIMEFRAMES.slice(startIdx)) {
    const capMs = Number.isFinite(MAX_DEPTH_S[tf]) ? nowMs - MAX_DEPTH_S[tf] * 1000 : -Infinity;
    const untilMs = Math.max(targetMs, capMs);
    if (untilMs >= nowMs) continue; // cap leaves nothing to load
    const barsNeeded = Math.ceil((nowMs - untilMs) / 1000 / TF_SECONDS[tf]);
    const maxPages = Math.min(Math.ceil(barsNeeded / 1000) + 1, Math.ceil(MAX_BARS_PER_TF / 1000));
    steps.push({ tf, untilMs, maxPages });
  }
  return steps;
}
