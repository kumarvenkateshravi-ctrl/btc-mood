// M8 — Evidence engine. Rule-per-layer extraction of supporting/opposing factors,
// every item tagged with its source layer and carrying interpolated values from
// the frozen v1.0 fields (traceability law). Spec §Evidence.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult, TrendStage } from '../lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import type { EvidenceItem } from './marketTypes';

const TRENDING_STAGES = new Set<TrendStage>(['breakout', 'confirmation', 'trend_establishment', 'healthy_pullback', 'continuation']);
const pct = (p: number) => Math.round(p * 100);

export function collectEvidence(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  lifecycle: TrendLifecycleResult,
  probability: ProbabilityResult,
): { supporting: EvidenceItem[]; opposing: EvidenceItem[] } {
  const supporting: EvidenceItem[] = [];
  const opposing: EvidenceItem[] = [];

  // --- supporting ---
  if (agreement.agreement >= 65)
    supporting.push({ source: 'M3', text: `strong ${agreement.dominantBias} consensus (${agreement.agreement}%)` });
  if (confidence.confidence >= 65)
    supporting.push({ source: 'M4', text: `high confidence (${confidence.confidence}%)` });
  if (hierarchy.alignment >= 65)
    supporting.push({ source: 'M5', text: `timeframes aligned (${hierarchy.alignment}%) under ${hierarchy.controller} control` });
  if (TRENDING_STAGES.has(lifecycle.stage) && lifecycle.lifecycleStrength >= 55)
    supporting.push({ source: 'M6', text: `${lifecycle.stage} stage with healthy lifecycle strength (${lifecycle.lifecycleStrength})` });
  if (probability.mostLikelyOutcome.probability >= 0.5)
    supporting.push({ source: 'M7', text: `probability currently favors ${probability.mostLikelyOutcome.outcome} (${pct(probability.mostLikelyOutcome.probability)}%)` });

  // --- opposing ---
  if (agreement.conflict >= 40)
    opposing.push({ source: 'M3', text: `directional conflict (${agreement.conflict}%)` });
  if (confidence.confidence < 45)
    opposing.push({ source: 'M4', text: `reduced confidence (${confidence.confidence}%)` });
  if (hierarchy.transition)
    opposing.push({ source: 'M5', text: 'market in transition' });
  if (lifecycle.invalidation.invalidated)
    opposing.push({ source: 'M6', text: `lifecycle invalidated: ${lifecycle.invalidation.condition}` });
  if (lifecycle.exhaustion >= 70)
    opposing.push({ source: 'M6', text: `momentum exhaustion (${lifecycle.exhaustion})` });
  for (const o of probability.marketOutcomes) {
    if ((o.outcome === 'reversal' || o.outcome === 'false_breakout') && o.probability >= 0.25)
      opposing.push({ source: 'M7', text: `elevated ${o.outcome} probability (${pct(o.probability)}%)` });
  }

  return { supporting, opposing };
}
