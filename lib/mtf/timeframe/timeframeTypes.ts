// M5 — Timeframe Hierarchy + Market Regime contract. First cross-timeframe layer:
// per-TF stationary regime + how the timeframes relate (authority, alignment,
// control transfer, overallMarketState). Consumes M0–M4 distillations only.
// Spec: docs/superpowers/specs/2026-07-19-m5-timeframe-hierarchy-market-regime-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';

/** Per-TF STATIONARY market character (no cross-TF context). */
export type RegimeType = 'trending_up' | 'trending_down' | 'ranging' | 'compression' | 'expansion';

/** Cross-TF composite headline (hierarchy-level). Pullback/transition/reversal live HERE, not in regime. */
export type OverallMarketState =
  | 'bullish_continuation' | 'bullish_pullback' | 'bullish_transition'
  | 'bearish_continuation' | 'bearish_pullback' | 'bearish_transition'
  | 'reversal_risk' | 'range_bound' | 'compression' | 'expansion';

export type TimeframeRole = 'context' | 'confirmation' | 'trigger';

export interface TimeframeSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

/** Regime engine output (used by the snapshot helper). */
export interface RegimeResult {
  schemaVersion: 1;
  regime: RegimeType;
  clarity: number;
  diagnostics: { trendStrength: number; volatility: number; direction: Verdict };
  signals: TimeframeSignal[];
}

/** Per-TF distillation of M0–M4 — the INPUT to M5 core (no candles, no authority/alignment). */
export interface TimeframeSnapshot {
  timeframe: Timeframe;
  bias: Verdict;          // agreement.dominantBias
  agreement: number;      // agreement.agreement (0–100)
  conflict: number;       // agreement.conflict (0–100)
  confidence: number;     // confidence.confidence (0–100)
  regime: RegimeType;
  regimeClarity: number;  // 0–100
}

/** Per-TF entry ENRICHED by the hierarchy engine. */
export interface TimeframeEntry {
  timeframe: Timeframe;
  bias: Verdict;
  confidence: number;
  regime: RegimeType;
  regimeClarity: number;
  role: TimeframeRole;
  authority: number;       // 0–100 intrinsic (confidence + clarity)
  agreesWithHTF: boolean;  // bias matches the controller's directional bias
}

export interface TimeframeContributor {
  timeframe: Timeframe;
  bias: Verdict;
  confidence: number;
  weight: number;
  authority: number;
}

/** Hierarchy engine OUTPUT. */
export interface HierarchyResult {
  schemaVersion: 1;
  htfBias: Verdict;
  alignment: number;            // 0–100 (M3 vote agreement over TFs)
  conflict: number;
  controller: Timeframe;
  controllerAuthority: number;
  overallMarketState: OverallMarketState;
  transition: boolean;
  perTimeframe: Partial<Record<Timeframe, TimeframeEntry>>;
  contributors: TimeframeContributor[];
  signals: TimeframeSignal[];
  warnings: TimeframeSignal[];
}
