// M8 — Market-level Opportunity: is there actually something worth attention?
// Weighted blend across the frozen v1.0 scores, consuming M7's distribution-level
// opportunity as ONE input. No price, no RR, no entries — M9 owns those.
// Spec §Opportunity.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import { clamp } from '../indicators/shared';
import type { MarketGrade } from './marketTypes';
import { OPP_GRADES, OPP_WEIGHTS } from './config';

export function marketOpportunity(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  lifecycle: TrendLifecycleResult,
  probability: ProbabilityResult,
): { score: number; grade: MarketGrade } {
  const W = OPP_WEIGHTS;
  const score = Math.round(clamp(
    W.agreement * agreement.agreement +
    W.confidence * confidence.confidence +
    W.outcomeProb * (100 * probability.mostLikelyOutcome.probability) +
    W.lifecycleStrength * lifecycle.lifecycleStrength +
    W.m7Opportunity * probability.opportunity.score,
    0, 100));
  const G = OPP_GRADES;
  const grade: MarketGrade =
    score >= G['A+'] ? 'A+' : score >= G.A ? 'A' : score >= G.B ? 'B' : score >= G.C ? 'C' : score >= G.D ? 'D' : 'F';
  return { score, grade };
}
