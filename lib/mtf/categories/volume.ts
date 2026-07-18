// M2 — Volume category. Consumes M1 diagnostics only (volume / obv).
// Formulas frozen in docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, VolumeState } from '../categoryTypes';
import { type IndicatorMap, clamp, conv, dim, mean, noEvidence, voteOf } from './shared';

export const VOLCAT_CONTRIBUTORS = ['volume', 'obv'];
/** Conservative default; tuned later against BTC data; API stable. */
export const VOLCAT_CONFIDENCE_WEIGHTS = { pressure: 0.3, confirmation: 0.3, participation: 0.2, consistency: 0.2 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const VOLCAT_STRENGTH_WEIGHTS = { participation: 0.4, consistency: 0.3, surge: 0.3 } as const;

export interface VolumeCategoryDiagnostics extends CategoryDiagnostics {
  pressure: number; confirmation: number; participation: number; surge: number; consistency: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildVolumeConfidence(d: VolumeCategoryDiagnostics): number {
  const W = VOLCAT_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.pressure * conv(d.pressure) + W.confirmation * conv(d.confirmation) +
    W.participation * d.participation + W.consistency * d.consistency, 0, 100));
}

/** Direction-independent volume quality 0–100. */
export function buildVolumeStrength(d: VolumeCategoryDiagnostics): number {
  const S = VOLCAT_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.participation * d.participation + S.consistency * d.consistency + S.surge * d.surge, 0, 100));
}

function stateOf(score: number, participation: number): VolumeState {
  if (participation <= 25) return 'quiet';
  if (score >= 60) return 'buying_pressure';
  if (score <= 40) return 'selling_pressure';
  return 'balanced';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'volume', source });

export function evaluateVolumeCategory(map: IndicatorMap): CategoryResult<VolumeState> {
  const pressure = dim(map, 'volume', 'pressure', 50);
  const confirmation = dim(map, 'obv', 'trend', 50);
  const surge = dim(map, 'volume', 'surge', 0);
  const consistency = dim(map, 'obv', 'consistency', 0);
  const participation = mean([surge, conv(dim(map, 'volume', 'trend', 50)), consistency]);

  const diagnostics: VolumeCategoryDiagnostics = { pressure, confirmation, participation, surge, consistency };
  const score = Math.round(0.5 * pressure + 0.5 * confirmation);

  if (noEvidence([pressure, confirmation], [participation, surge, consistency])) {
    return {
      id: 'volume', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'balanced', contributors: VOLCAT_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const state = stateOf(score, participation);

  const signals: CategorySignal[] = [];
  if (score >= 65) signals.push(sig('BUYING_PRESSURE', 'Buying Pressure', 'strong', ['volume', 'obv']));
  if (score <= 35) signals.push(sig('SELLING_PRESSURE', 'Selling Pressure', 'strong', ['volume', 'obv']));
  if (surge >= 70) signals.push(sig('VOLUME_SURGE', 'Volume Surge', 'strong', ['volume']));
  if (participation <= 25) signals.push(sig('LOW_PARTICIPATION', 'Low Participation', 'info', ['volume', 'obv']));

  const warnings: CategorySignal[] = [];
  const pVote = voteOf(pressure);
  const cVote = voteOf(confirmation);
  if (pVote !== 0 && cVote !== 0 && pVote !== cVote)
    warnings.push(sig('VOLUME_UNCONFIRMED', 'Volume Unconfirmed By OBV', 'warning', ['volume', 'obv']));
  if (consistency <= 30) warnings.push(sig('VOLUME_CHOPPY', 'Choppy Volume Flow', 'warning', ['obv']));

  return {
    id: 'volume', score, verdict: verdictOf(score), confidence: buildVolumeConfidence(diagnostics),
    strength: buildVolumeStrength(diagnostics), state, contributors: VOLCAT_CONTRIBUTORS,
    diagnostics, signals, warnings,
  };
}
