// M7 — Opportunity. Distribution ACTIONABILITY only: how concentrated the outcome
// distribution is and how clear the direction is. Deliberately minimal — NOT trade
// quality: expectedRR / execution quality require price levels (entry/stop/target)
// that M7 cannot see; M9 (Trade Decision) owns those. Spec §Opportunity.

import type { DirectionalProbability, OpportunityGrade, OutcomeProbability } from './probabilityTypes';
import { OPPORTUNITY_GRADES } from './config';

export function opportunityOf(
  mostLikelyOutcome: OutcomeProbability,
  dominantDirection: DirectionalProbability,
): { score: number; grade: OpportunityGrade } {
  const score = Math.round(100 * (0.6 * mostLikelyOutcome.probability + 0.4 * dominantDirection.probability));
  const grade: OpportunityGrade =
    score >= OPPORTUNITY_GRADES.A ? 'A' : score >= OPPORTUNITY_GRADES.B ? 'B' : score >= OPPORTUNITY_GRADES.C ? 'C' : 'D';
  return { score, grade };
}
