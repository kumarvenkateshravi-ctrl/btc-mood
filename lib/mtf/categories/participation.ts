// M2 — Participation category. Consumes M1 diagnostics only (volume / obv / ema).
// Independent of other categories (MTFM2Enhnce1 #5): trend support compares OBV
// flow against the EMA indicator's side, not the Trend category. Formulas frozen
// in docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, ParticipationState } from '../categoryTypes';
import { type IndicatorMap, clamp, conv, dim, mean, noEvidence, voteOf } from './shared';

export const PART_CONTRIBUTORS = ['volume', 'obv', 'ema'];
/** Conservative default; tuned later against BTC data; API stable. */
export const PART_CONFIDENCE_WEIGHTS = { interest: 0.3, flowAlignment: 0.2, trendSupport: 0.2, activity: 0.15, commitment: 0.15 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const PART_STRENGTH_WEIGHTS = { activity: 0.35, commitment: 0.35, trendSupport: 0.3 } as const;

export interface ParticipationCategoryDiagnostics extends CategoryDiagnostics {
  interest: number; flowAlignment: number; activity: number; trendSupport: number; commitment: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildParticipationConfidence(d: ParticipationCategoryDiagnostics): number {
  const W = PART_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.interest * conv(d.interest) + W.flowAlignment * conv(d.flowAlignment) +
    W.trendSupport * d.trendSupport + W.activity * d.activity + W.commitment * d.commitment, 0, 100));
}

/** Direction-independent participation quality 0–100. */
export function buildParticipationStrength(d: ParticipationCategoryDiagnostics): number {
  const S = PART_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.activity * d.activity + S.commitment * d.commitment + S.trendSupport * d.trendSupport, 0, 100));
}

function stateOf(score: number, activity: number): ParticipationState {
  if (activity <= 25) return 'weak_participation';
  if (score >= 65 && activity >= 50) return 'strong_buying_interest';
  if (score >= 58) return 'buying_interest';
  if (score <= 35 && activity >= 50) return 'strong_selling_interest';
  if (score <= 42) return 'selling_interest';
  return 'neutral';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'participation', source });

export function evaluateParticipationCategory(map: IndicatorMap): CategoryResult<ParticipationState> {
  const pressure = dim(map, 'volume', 'pressure', 50);
  const obvTrend = dim(map, 'obv', 'trend', 50);
  const interest = mean([pressure, obvTrend]);
  const flowAlignment = obvTrend;
  const activity = mean([dim(map, 'volume', 'surge', 0), conv(pressure)]);
  const commitment = mean([dim(map, 'obv', 'consistency', 0), conv(dim(map, 'volume', 'trend', 50))]);

  const obvVote = voteOf(obvTrend);
  const emaVote = voteOf(map['ema']?.score ?? 50);
  const trendSupport = obvVote === 0 || emaVote === 0 ? 50 : obvVote === emaVote ? 100 : 0;

  const diagnostics: ParticipationCategoryDiagnostics = { interest, flowAlignment, activity, trendSupport, commitment };
  const score = Math.round(interest);

  // trendSupport's neutral is 50 (not 0), so the no-evidence check excludes it.
  if (noEvidence([interest, flowAlignment], [activity, commitment])) {
    return {
      id: 'participation', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'neutral', contributors: PART_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const state = stateOf(score, activity);

  const signals: CategorySignal[] = [];
  if (activity >= 70 && trendSupport === 100)
    signals.push(sig('PART_STRONG', 'Strong Committed Participation', 'strong', ['volume', 'obv', 'ema']));
  if (score >= 60) signals.push(sig('PART_BUYING', 'Buying Interest', 'info', ['volume', 'obv']));
  if (score <= 40) signals.push(sig('PART_SELLING', 'Selling Interest', 'info', ['volume', 'obv']));

  const warnings: CategorySignal[] = [];
  if (activity <= 25) warnings.push(sig('PART_WEAK', 'Weak Participation', 'warning', ['volume', 'obv']));
  if (trendSupport === 0) warnings.push(sig('PART_UNSUPPORTED_TREND', 'Flow Opposes Trend', 'warning', ['obv', 'ema']));

  return {
    id: 'participation', score, verdict: verdictOf(score), confidence: buildParticipationConfidence(diagnostics),
    strength: buildParticipationStrength(diagnostics), state, contributors: PART_CONTRIBUTORS,
    diagnostics, signals, warnings,
  };
}
