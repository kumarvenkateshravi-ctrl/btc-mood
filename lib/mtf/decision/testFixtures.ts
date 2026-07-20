// M9 — TEST-ONLY fixture factories (imported exclusively by *.test.ts files in
// lib/mtf/decision/). Builds real MarketIntelligenceResult objects through the
// frozen M8 engine, then section-wise overrides the fields the decision modules
// read — the same pattern as lib/mtf/market/testFixtures.ts.

import { computeMarketIntelligence } from '../market/marketEngine';
import type { FullMarketIntelligence } from '../market/marketEngine';
import type { MarketIntelligenceResult } from '../market/marketTypes';
import { agr, conf, hier, lcyc, prob } from '../market/testFixtures';
import type { HierarchyResult } from '../timeframe/timeframeTypes';

export interface MarketPatch {
  readiness?: Partial<MarketIntelligenceResult['readiness']>;
  headline?: Partial<MarketIntelligenceResult['headline']>;
  risk?: Partial<MarketIntelligenceResult['risk']>;
  quality?: Partial<MarketIntelligenceResult['quality']>;
  outlook?: Partial<Omit<MarketIntelligenceResult['outlook'], 'invalidation'>> & {
    invalidation?: Partial<MarketIntelligenceResult['outlook']['invalidation']>;
  };
}

export function mkMarket(patch: MarketPatch = {}): MarketIntelligenceResult {
  const base = computeMarketIntelligence(agr(), conf(), hier(), lcyc(), prob());
  return {
    ...base,
    readiness: { ...base.readiness, ...patch.readiness },
    headline: { ...base.headline, ...patch.headline },
    risk: { ...base.risk, ...patch.risk },
    quality: { ...base.quality, ...patch.quality },
    outlook: {
      ...base.outlook,
      ...patch.outlook,
      invalidation: { ...base.outlook.invalidation, ...patch.outlook?.invalidation },
    },
  };
}

export function mkFullIntel(
  market: MarketIntelligenceResult = mkMarket(),
  hierarchy: HierarchyResult = hier(),
): FullMarketIntelligence {
  return {
    result: market,
    layers: {
      snapshots: [],
      hierarchy,
      lifecycle: lcyc(),
      agreement: agr(),
      confidence: conf(),
      probability: prob(),
    },
  };
}
