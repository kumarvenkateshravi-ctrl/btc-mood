// M2 — Momentum category. Consumes M1 diagnostics only (rsi / macd / adx).
// Formulas frozen in docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import { verdictOf } from '../types';
import type { CategoryDiagnostics, CategoryResult, CategorySignal, MomentumState } from '../categoryTypes';
import { type IndicatorMap, clamp, conv, dim, mean, noEvidence, voteAgreement, voteOf } from './shared';

export const MOM_CONTRIBUTORS = ['rsi', 'macd', 'adx'];
/** Conservative default; tuned later against BTC data; API stable. */
export const MOM_CONFIDENCE_WEIGHTS = { speed: 0.3, acceleration: 0.25, continuation: 0.25, consistency: 0.2 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const MOM_STRENGTH_WEIGHTS = { acceleration: 0.35, consistency: 0.35, speed: 0.3 } as const;

export interface MomentumCategoryDiagnostics extends CategoryDiagnostics {
  speed: number; acceleration: number; continuation: number; exhaustion: number; consistency: number;
}

/** Category-local confidence 0–100 from the diagnostics object only. */
export function buildMomentumConfidence(d: MomentumCategoryDiagnostics): number {
  const W = MOM_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.speed * conv(d.speed) + W.acceleration * conv(d.acceleration) +
    W.continuation * conv(d.continuation) + W.consistency * d.consistency, 0, 100));
}

/** Direction-independent momentum quality 0–100. */
export function buildMomentumStrength(d: MomentumCategoryDiagnostics): number {
  const S = MOM_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.acceleration * conv(d.acceleration) + S.consistency * d.consistency + S.speed * conv(d.speed), 0, 100));
}

function stateOf(score: number, accel: number, exhaustion: number): MomentumState {
  if (exhaustion >= 70) return 'overheated';
  const fading = Math.abs(score - 50) >= 10 && ((score > 50 && accel <= 40) || (score < 50 && accel >= 60));
  if (fading) return 'fading';
  const accelerating = (score >= 60 && accel >= 60) || (score <= 40 && accel <= 40);
  if (accelerating) return 'accelerating';
  if (score >= 60) return 'bullish';
  if (score <= 40) return 'bearish';
  return 'flat';
}

const sig = (code: string, message: string, severity: CategorySignal['severity'], source: string[]): CategorySignal =>
  ({ code, message, severity, category: 'momentum', source });

export function evaluateMomentumCategory(map: IndicatorMap): CategoryResult<MomentumState> {
  const speed = dim(map, 'rsi', 'position', 50);
  const acceleration = mean([dim(map, 'macd', 'histMomentum', 50), dim(map, 'rsi', 'momentum', 50)]);
  const continuation = mean([dim(map, 'macd', 'crossState', 50), dim(map, 'adx', 'adxMomentum', 50)]);
  const exhaustion = speed >= 70 ? ((speed - 70) / 30) * 100 : speed <= 30 ? ((30 - speed) / 30) * 100 : 0;
  const consistency = voteAgreement([voteOf(speed), voteOf(acceleration), voteOf(continuation)]);

  const diagnostics: MomentumCategoryDiagnostics = { speed, acceleration, continuation, exhaustion, consistency };
  const score = Math.round(0.4 * speed + 0.3 * acceleration + 0.3 * continuation);

  if (noEvidence([speed, acceleration, continuation], [exhaustion, consistency])) {
    return {
      id: 'momentum', score: 50, verdict: 'neutral', confidence: 50, strength: 0,
      state: 'flat', contributors: MOM_CONTRIBUTORS, diagnostics, signals: [], warnings: [],
    };
  }

  const state = stateOf(score, acceleration, exhaustion);

  const signals: CategorySignal[] = [];
  if (state === 'accelerating') signals.push(sig('MOM_ACCELERATING', 'Momentum Accelerating', 'info', ['macd', 'rsi']));
  if (state === 'fading') signals.push(sig('MOM_FADING', 'Momentum Fading', 'info', ['macd', 'rsi']));
  if (exhaustion >= 70) signals.push(sig('MOM_OVERHEATED', 'Momentum Overheated', 'strong', ['rsi']));
  if (score < 45 && acceleration >= 60) signals.push(sig('MOM_RECOVERING', 'Momentum Recovering', 'info', ['macd', 'rsi']));

  const warnings: CategorySignal[] = [];
  const sVote = voteOf(speed);
  const aVote = voteOf(acceleration);
  if (sVote !== 0 && aVote !== 0 && sVote !== aVote && Math.abs(speed - acceleration) >= 40)
    warnings.push(sig('MOM_DIVERGENCE', 'Momentum Divergence', 'warning', ['rsi', 'macd']));
  if (score > 40 && score < 60 && consistency <= 33)
    warnings.push(sig('MOM_STALLED', 'Momentum Stalled', 'warning', ['rsi', 'macd', 'adx']));

  return {
    id: 'momentum', score, verdict: verdictOf(score), confidence: buildMomentumConfidence(diagnostics),
    strength: buildMomentumStrength(diagnostics), state, contributors: MOM_CONTRIBUTORS,
    diagnostics, signals, warnings,
  };
}
