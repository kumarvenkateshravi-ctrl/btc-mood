// M9 — risk tier. Account-agnostic sizing signal derived from M8's decomposed
// verdicts. Consumers convert tiers to size against their own equity — M9 never
// knows equity, so concrete sizes would be fake precision.

import type { MarketIntelligenceResult, QualityLevel, RiskLevel } from '../market/marketTypes';
import { PRIOR_TIER_CAP } from './config';
import type { RiskTier } from './decisionTypes';

const QUALITY_RANK: Record<QualityLevel, number> = { excellent: 4, good: 3, average: 2, poor: 1, dangerous: 0 };
const RISK_RANK: Record<RiskLevel, number> = { very_low: 0, low: 1, medium: 2, high: 3, extreme: 4 };

/** First-match ladder; the prior-calibration cap bites only when the ladder chose
 *  'full' — model priors never justify full risk. */
export function riskTierOf(
  market: MarketIntelligenceResult,
  gatePassed: boolean,
): { tier: RiskTier; capped: boolean } {
  if (!gatePassed) return { tier: 'none', capped: false };
  const q = QUALITY_RANK[market.quality.level];
  const r = RISK_RANK[market.risk.level];
  let tier: RiskTier;
  if (q >= QUALITY_RANK.excellent && r <= RISK_RANK.low) tier = 'full';
  else if (q >= QUALITY_RANK.good && r <= RISK_RANK.medium) tier = 'half';
  else tier = 'quarter';
  if (tier === 'full' && market.headline.calibration === 'prior') {
    return { tier: PRIOR_TIER_CAP, capped: true };
  }
  return { tier, capped: false };
}
