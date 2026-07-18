// M2 — Trend category. Consumes M1 diagnostics only (ema / supertrend / adx).
// Formulas frozen in docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, TrendState } from '../categoryTypes';
import { type IndicatorMap, clamp, conv, dim, mean, noEvidence, voteAgreement, voteOf } from './shared';

export const TREND_CONTRIBUTORS = ['ema', 'supertrend', 'adx'];
/** Conservative default; tuned later against BTC data; API stable. */
export const TREND_CONFIDENCE_WEIGHTS = { direction: 0.3, alignment: 0.25, agreement: 0.2, persistence: 0.15, quality: 0.1 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const TREND_STRENGTH_WEIGHTS = { quality: 0.35, persistence: 0.3, agreement: 0.2, alignment: 0.15 } as const;

export interface TrendCategoryDiagnostics extends CategoryDiagnostics {
  alignment: number; direction: number; persistence: number; agreement: number; quality: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildTrendConfidence(d: TrendCategoryDiagnostics): number {
  const W = TREND_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.direction * conv(d.direction) + W.alignment * conv(d.alignment) +
    W.agreement * d.agreement + W.persistence * d.persistence + W.quality * d.quality, 0, 100));
}

/** Direction-independent trend quality 0–100. */
export function buildTrendStrength(d: TrendCategoryDiagnostics): number {
  const S = TREND_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.quality * d.quality + S.persistence * d.persistence + S.agreement * d.agreement +
    S.alignment * conv(d.alignment), 0, 100));
}

function stateOf(score: number, strength: number): TrendState {
  if (score >= 70 && strength >= 60) return 'strong_bullish';
  if (score >= 60) return 'bullish';
  if (score <= 30 && strength >= 60) return 'strong_bearish';
  if (score <= 40) return 'bearish';
  return 'ranging';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'trend', source });

export function evaluateTrendCategory(map: IndicatorMap): CategoryResult<TrendState> {
  const alignment = dim(map, 'ema', 'alignment', 50);
  const emaScore = map['ema']?.score ?? 50;
  const side = dim(map, 'supertrend', 'side', 50);
  const adxDir = dim(map, 'adx', 'direction', 50);
  const flipFreshness = dim(map, 'supertrend', 'flipFreshness', 50);

  const direction = mean([emaScore, side, adxDir]);
  const persistence = dim(map, 'supertrend', 'persistence', 0);
  const agreement = voteAgreement([voteOf(emaScore), voteOf(side), voteOf(adxDir)]);
  const quality = mean([dim(map, 'ema', 'separation', 0), dim(map, 'adx', 'trendStrength', 0)]);

  const diagnostics: TrendCategoryDiagnostics = { alignment, direction, persistence, agreement, quality };
  const score = Math.round(direction);

  if (noEvidence([alignment, direction], [persistence, agreement, quality])) {
    return {
      id: 'trend', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'ranging', contributors: TREND_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const strength = buildTrendStrength(diagnostics);
  const state = stateOf(score, strength);

  const signals: CategorySignal[] = [];
  if (state === 'strong_bullish' || state === 'strong_bearish')
    signals.push(sig('TREND_STRONG', 'Strong Trend Agreement', 'strong', ['ema', 'supertrend', 'adx']));
  if (score >= 55 && score < 70 && persistence >= 70)
    signals.push(sig('TREND_BUILDING', 'Trend Building', 'info', ['supertrend']));
  const sideVote = voteOf(side);
  const alignVote = voteOf(alignment);
  if (flipFreshness >= 70 && sideVote !== 0 && alignVote !== 0 && sideVote !== alignVote)
    signals.push(sig('TREND_REVERSING', 'Fresh Flip Against Alignment', 'info', ['supertrend', 'ema']));
  if (score > 40 && score < 60 && quality <= 25 && persistence <= 60)
    signals.push(sig('TREND_BREAKDOWN', 'Trend Structure Breakdown', 'strong', ['ema', 'adx', 'supertrend']));

  const warnings: CategorySignal[] = [];
  if (quality <= 30 && Math.abs(score - 50) >= 10)
    warnings.push(sig('TREND_WEAKENING', 'Trend Weakening', 'warning', ['ema', 'adx']));
  if (agreement <= 33)
    warnings.push(sig('TREND_DISAGREEMENT', 'Indicators Disagree On Trend', 'warning', ['ema', 'supertrend', 'adx']));
  if (persistence <= 60)
    warnings.push(sig('TREND_CHOPPY', 'Choppy Trend', 'warning', ['supertrend']));

  return {
    id: 'trend', score, verdict: verdictOf(score), confidence: buildTrendConfidence(diagnostics),
    strength, state, contributors: TREND_CONTRIBUTORS, diagnostics, signals, warnings,
  };
}
