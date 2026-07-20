// M8 — Narrative engine. Deterministic executive summary: six ordered template
// sentences composed purely from frozen v1.0 fields — NOT AI-generated (the AI
// layer later expands this object). Descriptive vocabulary only; probability is
// phrased as "currently favors" (banned-vocabulary tested). Spec §Narrative.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import type { MarketGrade, QualityLevel, ReadinessState } from './marketTypes';

const title = (s: string) => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const words = (s: string) => s.replace(/_/g, ' ');

export function composeNarrative(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  probability: ProbabilityResult,
  quality: { score: number; level: QualityLevel; reasons: string[] },
  opportunity: { score: number; grade: MarketGrade },
  readiness: { state: ReadinessState; reason: string },
): string[] {
  return [
    `${hierarchy.controller} remains in control of the market structure.`,
    `The market is in a ${title(hierarchy.overallMarketState)} state.`,
    `Agreement stands at ${agreement.agreement}% with ${words(confidence.state)} confidence (${confidence.confidence}%).`,
    `Probability currently favors ${words(probability.mostLikelyOutcome.outcome)} (${Math.round(probability.mostLikelyOutcome.probability * 100)}%).`,
    `Market quality is ${quality.level} with opportunity grade ${opportunity.grade}.`,
    `Trading environment: ${words(readiness.state)} (${readiness.reason}).`,
  ];
}
