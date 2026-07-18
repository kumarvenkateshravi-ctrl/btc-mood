// M2 — Volatility category. Non-directional (score always 50); intensity lives
// in `strength`. Consumes M1 diagnostics only (supertrend distance / macd
// separation); ATR is a future input. No-evidence uses the consumed inputs, not
// the derived squeeze/stability. Formulas frozen in
// docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, VolatilityState } from '../categoryTypes';
import { type IndicatorMap, clamp, dim, mean, noEvidence } from './shared';

export const VOLA_CONTRIBUTORS = ['supertrend', 'macd'];
/** Conservative default; tuned later against BTC data; API stable. */
export const VOLA_CONFIDENCE_WEIGHTS = { expansion: 0.4, stability: 0.3, impulse: 0.15, distance: 0.15 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const VOLA_STRENGTH_WEIGHTS = { expansion: 0.5, impulse: 0.25, distance: 0.25 } as const;

export interface VolatilityCategoryDiagnostics extends CategoryDiagnostics {
  expansion: number; distance: number; impulse: number; squeeze: number; stability: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildVolatilityConfidence(d: VolatilityCategoryDiagnostics): number {
  const W = VOLA_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.expansion * d.expansion + W.stability * d.stability + W.impulse * d.impulse + W.distance * d.distance, 0, 100));
}

/** Volatility intensity 0–100 (direction-independent). */
export function buildVolatilityStrength(d: VolatilityCategoryDiagnostics): number {
  const S = VOLA_STRENGTH_WEIGHTS;
  return Math.round(clamp(S.expansion * d.expansion + S.impulse * d.impulse + S.distance * d.distance, 0, 100));
}

function stateOf(expansion: number, squeeze: number): VolatilityState {
  if (expansion >= 60) return 'expanding';
  if (squeeze >= 70) return 'compressed';
  return 'normal';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'volatility', source });

export function evaluateVolatilityCategory(map: IndicatorMap): CategoryResult<VolatilityState> {
  const distance = dim(map, 'supertrend', 'distance', 0);
  const impulse = dim(map, 'macd', 'separation', 0);
  const expansion = mean([distance, impulse]);
  const squeeze = clamp(100 - expansion, 0, 100);
  const stability = clamp(100 - Math.abs(distance - impulse), 0, 100);

  const diagnostics: VolatilityCategoryDiagnostics = { expansion, distance, impulse, squeeze, stability };

  // No-evidence uses the CONSUMED inputs (distance, impulse) — squeeze/stability
  // saturate to 100 when empty and must not be treated as evidence.
  if (noEvidence([], [distance, impulse])) {
    return {
      id: 'volatility', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'normal', contributors: VOLA_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const state = stateOf(expansion, squeeze);

  const signals: CategorySignal[] = [];
  if (expansion >= 70) signals.push(sig('VOLATILITY_EXPANSION', 'Volatility Expansion', 'strong', ['supertrend', 'macd']));
  if (squeeze >= 70) signals.push(sig('VOLATILITY_SQUEEZE', 'Volatility Squeeze', 'info', ['supertrend', 'macd']));
  if (impulse >= 70) signals.push(sig('VOLATILITY_IMPULSE', 'Volatility Impulse', 'info', ['macd']));

  const warnings: CategorySignal[] = [];
  if (expansion >= 85) warnings.push(sig('HIGH_VOLATILITY', 'High Volatility', 'warning', ['supertrend', 'macd']));
  if (stability <= 30) warnings.push(sig('VOLATILITY_DISAGREEMENT', 'Volatility Measures Disagree', 'warning', ['supertrend', 'macd']));

  return {
    id: 'volatility', score: 50, verdict: verdictOf(50), confidence: buildVolatilityConfidence(diagnostics),
    strength: buildVolatilityStrength(diagnostics), state, contributors: VOLA_CONTRIBUTORS,
    diagnostics, signals, warnings,
  };
}
