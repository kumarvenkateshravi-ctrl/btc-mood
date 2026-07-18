// M2 — Category Intelligence engine. Projects M1 IndicatorResult[] into the six
// category results (typed Record). Deterministic; no candles, no recomputation,
// no cross-category dependencies. M3 owns Market Confidence.
// Spec: docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import type { IndicatorResult } from './intelligence';
import type { CategoryEngineResult, CategoryId } from './categoryTypes';
import { toMap } from './categories/shared';
import { evaluateTrendCategory, TREND_CONTRIBUTORS } from './categories/trend';
import { evaluateMomentumCategory, MOM_CONTRIBUTORS } from './categories/momentum';
import { evaluateVolumeCategory, VOLCAT_CONTRIBUTORS } from './categories/volume';
import { evaluateVolatilityCategory, VOLA_CONTRIBUTORS } from './categories/volatility';
import { evaluateQualityCategory, QUAL_CONTRIBUTORS } from './categories/quality';
import { evaluateParticipationCategory, PART_CONTRIBUTORS } from './categories/participation';

/** Data-schema version (MTFM2Enhnce1 #4) — bump only on a breaking shape change. */
export const CATEGORY_SCHEMA_VERSION = 1 as const;

/** Which indicator ids each category consumes (traceability, MTFM2Enhnce1 #3). */
export const CATEGORY_CONTRIBUTORS: Record<CategoryId, string[]> = {
  trend: TREND_CONTRIBUTORS,
  momentum: MOM_CONTRIBUTORS,
  volume: VOLCAT_CONTRIBUTORS,
  volatility: VOLA_CONTRIBUTORS,
  quality: QUAL_CONTRIBUTORS,
  participation: PART_CONTRIBUTORS,
};

/** Pure, deterministic projection of M1 indicator intelligence into categories. */
export function computeCategoryIntelligence(indicators: IndicatorResult[]): CategoryEngineResult {
  const map = toMap(indicators);
  return {
    schemaVersion: CATEGORY_SCHEMA_VERSION,
    categories: {
      trend: evaluateTrendCategory(map),
      momentum: evaluateMomentumCategory(map),
      volume: evaluateVolumeCategory(map),
      volatility: evaluateVolatilityCategory(map),
      quality: evaluateQualityCategory(map),
      participation: evaluateParticipationCategory(map),
    },
  };
}
