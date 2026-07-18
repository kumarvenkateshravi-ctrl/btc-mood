// M2 — Trend Quality category. Non-directional (score always 50); trend health
// lives in `strength`/`state`. Consumes M1 diagnostics only (ema separation,
// adx strength, supertrend persistence, macd separation). `agreement` is derived,
// so no-evidence checks the four consumed inputs. Formulas frozen in
// docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, QualityState } from '../categoryTypes';
import { type IndicatorMap, clamp, dim, noEvidence } from './shared';

export const QUAL_CONTRIBUTORS = ['ema', 'adx', 'supertrend', 'macd'];
/** Conservative default; tuned later against BTC data; API stable. */
export const QUAL_CONFIDENCE_WEIGHTS = { agreement: 0.3, strength: 0.25, separation: 0.2, persistence: 0.15, impulse: 0.1 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const QUAL_STRENGTH_WEIGHTS = { strength: 0.3, separation: 0.25, persistence: 0.25, impulse: 0.2 } as const;

export interface QualityCategoryDiagnostics extends CategoryDiagnostics {
  separation: number; strength: number; persistence: number; impulse: number; agreement: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildQualityConfidence(d: QualityCategoryDiagnostics): number {
  const W = QUAL_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.agreement * d.agreement + W.strength * d.strength + W.separation * d.separation +
    W.persistence * d.persistence + W.impulse * d.impulse, 0, 100));
}

/** Trend-health quality 0–100 (direction-independent). */
export function buildQualityStrength(d: QualityCategoryDiagnostics): number {
  const S = QUAL_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.strength * d.strength + S.separation * d.separation + S.persistence * d.persistence +
    S.impulse * d.impulse, 0, 100));
}

function stateOf(catStrength: number, persistence: number): QualityState {
  if (persistence <= 50) return 'choppy';
  if (catStrength >= 70) return 'healthy';
  if (catStrength >= 50) return 'developing';
  return 'weak';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'quality', source });

export function evaluateQualityCategory(map: IndicatorMap): CategoryResult<QualityState> {
  const separation = dim(map, 'ema', 'separation', 0);
  const strength = dim(map, 'adx', 'trendStrength', 0);
  const persistence = dim(map, 'supertrend', 'persistence', 0);
  const impulse = dim(map, 'macd', 'separation', 0);
  const four = [separation, strength, persistence, impulse];
  const agreement = clamp(100 - (Math.max(...four) - Math.min(...four)), 0, 100);

  const diagnostics: QualityCategoryDiagnostics = { separation, strength, persistence, impulse, agreement };

  if (noEvidence([], four)) {
    return {
      id: 'quality', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'developing', contributors: QUAL_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const catStrength = buildQualityStrength(diagnostics);
  const state = stateOf(catStrength, persistence);

  const signals: CategorySignal[] = [];
  if (state === 'healthy') signals.push(sig('QUALITY_HEALTHY', 'Healthy Trend Structure', 'strong', ['ema', 'adx', 'supertrend', 'macd']));
  if (agreement >= 70) signals.push(sig('QUALITY_AGREEMENT', 'Evidence In Agreement', 'info', ['ema', 'adx', 'supertrend', 'macd']));

  const warnings: CategorySignal[] = [];
  if (state === 'weak') warnings.push(sig('QUALITY_WEAK', 'Weak Trend Structure', 'warning', ['ema', 'adx', 'supertrend', 'macd']));
  if (state === 'choppy') warnings.push(sig('QUALITY_CHOPPY', 'Choppy Structure', 'warning', ['supertrend']));
  if (agreement <= 30) warnings.push(sig('QUALITY_MIXED_EVIDENCE', 'Mixed Evidence', 'warning', ['ema', 'adx', 'supertrend', 'macd']));

  return {
    id: 'quality', score: 50, verdict: verdictOf(50), confidence: buildQualityConfidence(diagnostics),
    strength: catStrength, state, contributors: QUAL_CONTRIBUTORS, diagnostics, signals, warnings,
  };
}
