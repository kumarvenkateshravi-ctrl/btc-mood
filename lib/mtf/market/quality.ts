// M8 — Market Quality: non-directional health of the market picture (how
// coherent/trustworthy, NOT which direction). Weighted blend of the frozen v1.0
// scores; reasons name components that are strong (≥65) or weak (≤35).
// Spec §Quality.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import { clamp } from '../indicators/shared';
import type { QualityLevel } from './marketTypes';
import { QUALITY_BANDS, QUALITY_WEIGHTS } from './config';

type ComponentKey = keyof typeof QUALITY_WEIGHTS;
const LABELS: Record<ComponentKey, { strong: string; weak: string }> = {
  confidence: { strong: 'strong confidence', weak: 'weak confidence' },
  agreement: { strong: 'strong agreement', weak: 'weak agreement' },
  alignment: { strong: 'aligned timeframes', weak: 'misaligned timeframes' },
  lifecycleStrength: { strong: 'healthy trend lifecycle', weak: 'weak trend lifecycle' },
  calm: { strong: 'low conflict', weak: 'high conflict' },
};

export function marketQuality(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  lifecycle: TrendLifecycleResult,
): { score: number; level: QualityLevel; reasons: string[] } {
  const components: Record<ComponentKey, number> = {
    confidence: confidence.confidence,
    agreement: agreement.agreement,
    alignment: hierarchy.alignment,
    lifecycleStrength: lifecycle.lifecycleStrength,
    calm: 100 - hierarchy.conflict,
  };

  let score = 0;
  const reasons: string[] = [];
  for (const key of Object.keys(QUALITY_WEIGHTS) as ComponentKey[]) {
    const value = components[key];
    score += QUALITY_WEIGHTS[key] * value;
    if (value >= 65) reasons.push(`${LABELS[key].strong} (${Math.round(value)})`);
    else if (value <= 35) reasons.push(`${LABELS[key].weak} (${Math.round(value)})`);
  }
  score = Math.round(clamp(score, 0, 100));

  const B = QUALITY_BANDS;
  const level: QualityLevel =
    score >= B.excellent ? 'excellent' : score >= B.good ? 'good' : score >= B.average ? 'average' : score >= B.poor ? 'poor' : 'dangerous';
  return { score, level, reasons };
}
