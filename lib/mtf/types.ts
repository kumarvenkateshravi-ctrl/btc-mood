// Shared contracts for the MTF Engine (M0: Indicator Registry). Pure types +
// tiny verdict helpers — no UI, no chart code, no React. Everything the engine
// produces speaks this language; see docs/architecture/mtf-engine.md.

import type { Candle } from '../types';
import type { IndicatorSettings } from '../indicatorFramework';

export type Verdict = 'bullish' | 'bearish' | 'neutral';

/** Which category engine an indicator will feed in later milestones. */
export type IndicatorCategory = 'trend' | 'momentum' | 'volume' | 'strength';

/** Machine-readable signal/warning emitted by an indicator (M1 contract). */
export interface IndicatorSignal {
  code: string;                       // e.g. 'EMA_ALIGNMENT_STRONG'
  message: string;                    // human-readable
  severity: 'info' | 'warning' | 'strong';
  /** Optional epoch-ms timing (unused in M1; replay/AI/reports attach later). */
  timestamp?: number;
}

/** Marker base for per-indicator diagnostics — each indicator OWNS its concrete
 * shape (EmaDiagnostics, later RsiDiagnostics, …); the registry never inspects it. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IndicatorDiagnostics {}

export interface IndicatorEvaluation {
  /** 0–100 directional sub-score (100 = max bull, 0 = max bear, 50 = neutral). */
  score: number;
  /** What a dashboard cell shows (a label or a formatted value). */
  display: string;
  // Optional indicator-local intelligence (M1). Absent → registry fills placeholders.
  confidence?: number;
  strength?: number;
  diagnostics?: IndicatorDiagnostics;
  signals?: IndicatorSignal[];
  warnings?: IndicatorSignal[];
}

export interface IndicatorDefinition {
  id: string;
  label: string;
  /** Settings summary shown under the label (e.g. '12,26,9'). */
  sub: string;
  /** 'label' rows show Bullish/Bearish; 'value' rows show a number/percent. */
  kind: 'label' | 'value';
  category: IndicatorCategory;
  /** Relative weight in the composite score; normalized across the roster. */
  defaultWeight: number;
  /** Pure, deterministic, closed-bar evaluation of one timeframe's candles. */
  evaluate(candles: Candle[], settings?: IndicatorSettings): IndicatorEvaluation;
  /** Settings summary for the given custom settings (falls back to `sub`). */
  subFor?(settings: IndicatorSettings): string;
}

/** Per-indicator weight overrides (partial; unlisted ids keep their default). */
export type IndicatorWeights = Record<string, number>;

/** Per-indicator custom settings (partial; unlisted/unknown ids are ignored). */
export type IndicatorSettingsMap = Record<string, IndicatorSettings>;

export const verdictOf = (score: number): Verdict =>
  score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral';

export const labelOf = (v: Verdict) =>
  v === 'bullish' ? 'Bullish' : v === 'bearish' ? 'Bearish' : 'Neutral';
