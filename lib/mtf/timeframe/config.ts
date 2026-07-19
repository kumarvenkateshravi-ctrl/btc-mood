// M5 — Timeframe configuration. Single source for the hierarchy and thresholds.
// Position-derived weights/roles (never hardcoded per literal TF) so a different
// trading style swaps TIMEFRAME_HIERARCHY with no engine change.
// Spec: docs/superpowers/specs/2026-07-19-m5-timeframe-hierarchy-market-regime-design.md

import type { Timeframe } from '../../types';
import type { TimeframeRole } from './timeframeTypes';

/** Ordered HIGHEST → LOWEST authority. Tunable; API stable. */
export const TIMEFRAME_HIERARCHY: Timeframe[] = ['1d', '4h', '1h', '30m', '15m', '5m'];

/** Position-derived weight: top TF = length, bottom = 1; unknown → 0. */
export function tfWeight(tf: Timeframe): number {
  const i = TIMEFRAME_HIERARCHY.indexOf(tf);
  return i < 0 ? 0 : TIMEFRAME_HIERARCHY.length - i;
}

/** Role by tier thirds of the hierarchy: top⅓ context, middle⅓ confirmation, bottom⅓ trigger. */
export function tfRole(tf: Timeframe): TimeframeRole {
  const i = TIMEFRAME_HIERARCHY.indexOf(tf);
  if (i < 0) return 'trigger';
  const third = TIMEFRAME_HIERARCHY.length / 3;
  return i < third ? 'context' : i < 2 * third ? 'confirmation' : 'trigger';
}

/** Conservative defaults; tuned later against BTC data; API stable. */
export const REGIME_THRESHOLDS = { trendStrong: 55, volHigh: 65 } as const;
export const AUTHORITY = { threshold: 55, confidenceWeight: 0.6, clarityWeight: 0.4 } as const;
export const HIERARCHY_THRESHOLDS = { aligned: 65, highConflict: 50, contextStrong: 60 } as const;
