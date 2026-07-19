// M4 — Category confidence pillar. Weighted mean over the DIRECTIONAL categories
// declared in CATEGORY_CONFIDENCE_FACTORS (quality/volatility are non-directional
// trust modifiers handled as penalties, not here). Spec §Pillars.

import type { CategoryResult } from '../categoryTypes';
import { CATEGORY_CONFIDENCE_FACTORS } from './config';

export { CATEGORY_CONFIDENCE_FACTORS };

/** Weighted mean of factor categories' confidence, normalized by present weights; none → 0. */
export function categoryConfidence(categories: CategoryResult[]): number {
  let sum = 0, wSum = 0;
  for (const c of categories) {
    const f = CATEGORY_CONFIDENCE_FACTORS[c.id];
    if (!f) continue; // unlisted / non-directional categories do not contribute to the base
    sum += f.weight * c.confidence;
    wSum += f.weight;
  }
  return wSum > 0 ? Math.round(sum / wSum) : 0;
}
