// M1.0 — the Indicator Intelligence contract. Architectural Rule: these values
// are INDICATOR-LOCAL evidence (Indicator Confidence / Indicator Strength), not
// market-level conclusions; later engines (Category, Confidence, Market Context,
// Decision) aggregate them. Pure types; imports one-directionally from types.ts.
//
// Evolution (locked direction, M2+): indicator modules will construct their full
// IndicatorIntelligence themselves and the registry will only register,
// orchestrate, and attach the effective weight. Not implemented in M1.

import type { IndicatorCategory, IndicatorDiagnostics, IndicatorSignal, Verdict } from './types';

export interface IndicatorIntelligence {
  id: string;
  category: IndicatorCategory;
  /** Frozen directional 0–100 score — unchanged from M0. */
  score: number;
  verdict: Verdict;
  /** Indicator Confidence 0–100 (placeholder = score until the indicator produces it). */
  confidence: number;
  /** Indicator Strength 0–100, direction-independent (placeholder = score). */
  strength: number;
  display: string;
  diagnostics: IndicatorDiagnostics;
  signals: IndicatorSignal[];
  warnings: IndicatorSignal[];
}

/** What the registry returns per indicator: full intelligence + applied weight. */
export type IndicatorResult = IndicatorIntelligence & { weight: number };
