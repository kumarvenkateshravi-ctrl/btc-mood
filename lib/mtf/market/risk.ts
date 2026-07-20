// M8 — Environment Risk: what kind of environment is this? Additive named
// points, each contributing factor becomes a reason (traceable, no hidden
// scoring). Uses the CROSS-TF conflict (hierarchy) and the AUTHORITY threshold
// from the frozen M5 config (no magic numbers). Spec §Risk.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import { AUTHORITY } from '../timeframe/config';
import { clamp } from '../indicators/shared';
import type { RiskLevel } from './marketTypes';
import { RISK_BANDS, RISK_POINTS } from './config';

export function marketRisk(
  _agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  lifecycle: TrendLifecycleResult,
  probability: ProbabilityResult,
): { score: number; level: RiskLevel; reasons: string[] } {
  const P = RISK_POINTS;
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    if (points <= 0) return;
    score += points;
    reasons.push(`${reason} (+${points})`);
  };

  add(Math.round(P.conflict * hierarchy.conflict / 100), 'timeframe conflict');
  if (hierarchy.transition) add(P.transition, 'market in transition');
  if (hierarchy.overallMarketState === 'reversal_risk') add(P.reversalRisk, 'reversal risk');
  if (hierarchy.controllerAuthority < AUTHORITY.threshold) add(P.weakController, 'weak controller authority');
  add(Math.round(P.lowConfidence * (100 - confidence.confidence) / 100), 'reduced confidence');
  if (lifecycle.invalidation.invalidated) add(P.invalidated, `lifecycle invalidated: ${lifecycle.invalidation.condition}`);
  if (probability.calibration === 'prior') add(P.priorCalibration, 'probabilities from model priors');
  if (hierarchy.perTimeframe[hierarchy.controller]?.regime === 'expansion') add(P.expansionRegime, 'expansion regime on controller');

  score = Math.round(clamp(score, 0, 100));
  const B = RISK_BANDS;
  const level: RiskLevel =
    score < B.veryLow ? 'very_low' : score < B.low ? 'low' : score < B.medium ? 'medium' : score < B.high ? 'high' : 'extreme';
  return { score, level, reasons };
}
