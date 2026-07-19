// M4 — Evidence engine. The one ORTHOGONAL positive: data completeness (how much
// evidence exists), distinct from the base (how confident/agreed it is). Spec §Evidence.

import type { IndicatorResult } from '../intelligence';
import type { CategoryResult } from '../categoryTypes';
import type { ConfidenceContributor } from './confidenceTypes';
import { CONFIDENCE_EVIDENCE } from './config';

/** Registry placeholder: no diagnostics were produced. */
const isSilentIndicator = (r: IndicatorResult): boolean => Object.keys(r.diagnostics as object).length === 0;
/** M2 no-evidence invariant: confidence 50, strength 0. */
const isSilentCategory = (c: CategoryResult): boolean => c.strength === 0 && c.confidence === 50;

export function computeEvidence(
  indicators: IndicatorResult[],
  categories: CategoryResult[],
): { contributors: ConfidenceContributor[]; completeness: number } {
  const total = indicators.length + categories.length;
  const silent = indicators.filter(isSilentIndicator).length + categories.filter(isSilentCategory).length;
  const completeness = total > 0 ? 1 - silent / total : 0;
  const bonus = Math.round(CONFIDENCE_EVIDENCE.completeness * completeness);
  const contributors: ConfidenceContributor[] = [];
  if (bonus > 0) contributors.push({ id: 'data_completeness', layer: 'indicator', kind: 'evidence', contribution: bonus });
  return { contributors, completeness };
}
