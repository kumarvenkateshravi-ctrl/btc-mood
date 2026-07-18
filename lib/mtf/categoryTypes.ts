// M2 — Category Intelligence contract. Categories answer "what does each market
// category think?" from M1 indicator intelligence ONLY (no candles, no cross-
// category deps). Category confidence is CATEGORY-local; M3 owns Market
// Confidence. Frozen spec:
// docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import type { Verdict } from './types';

export type CategoryId = 'trend' | 'momentum' | 'volume' | 'volatility' | 'quality' | 'participation';

// Typed state unions (MTFM2Enhnce1 #1) — snake_case, no free strings.
export type TrendState = 'strong_bullish' | 'bullish' | 'ranging' | 'bearish' | 'strong_bearish';
export type MomentumState = 'overheated' | 'fading' | 'accelerating' | 'bullish' | 'bearish' | 'flat';
export type VolumeState = 'quiet' | 'buying_pressure' | 'selling_pressure' | 'balanced';
export type VolatilityState = 'expanding' | 'compressed' | 'normal';
export type QualityState = 'healthy' | 'developing' | 'weak' | 'choppy';
export type ParticipationState =
  | 'weak_participation' | 'strong_buying_interest' | 'buying_interest'
  | 'selling_interest' | 'strong_selling_interest' | 'neutral';
export type CategoryState =
  TrendState | MomentumState | VolumeState | VolatilityState | QualityState | ParticipationState;

/** Marker base — each category owns its concrete diagnostics shape. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CategoryDiagnostics {}

/** Dedicated category signal (MTFM2Enhnce1 #2) — NOT an alias of IndicatorSignal. */
export interface CategorySignal {
  code: string;                                // e.g. 'TREND_STRONG'
  message: string;
  severity: 'info' | 'warning' | 'strong';
  category: CategoryId;
  /** Indicator ids that produced the evidence (traceability, MTFM2Enhnce1 #3). */
  source: string[];
  timestamp?: number;
}

export interface CategoryResult<S extends CategoryState = CategoryState> {
  id: CategoryId;
  /** Directional 0–100 (50 neutral). ALWAYS 50 for non-directional categories
   *  (volatility, quality) — their intensity lives in `strength`. */
  score: number;
  verdict: Verdict;
  /** CATEGORY-local confidence 0–100 (M3 aggregates to market level). */
  confidence: number;
  /** Direction-independent quality/intensity 0–100. */
  strength: number;
  state: S;
  /** Indicator ids this category consumes (MTFM2Enhnce1 #3). */
  contributors: string[];
  diagnostics: CategoryDiagnostics;
  signals: CategorySignal[];
  warnings: CategorySignal[];
}

export interface CategoryEngineResult {
  /** Data-schema version only (git owns code history) — MTFM2Enhnce1 #4. */
  schemaVersion: 1;
  categories: {
    trend: CategoryResult<TrendState>;
    momentum: CategoryResult<MomentumState>;
    volume: CategoryResult<VolumeState>;
    volatility: CategoryResult<VolatilityState>;
    quality: CategoryResult<QualityState>;
    participation: CategoryResult<ParticipationState>;
  };
}
