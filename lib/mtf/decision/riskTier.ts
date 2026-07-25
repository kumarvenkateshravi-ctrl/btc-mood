// M9 — risk tier. Account-agnostic sizing signal derived from M8's decomposed
// verdicts. Consumers convert tiers to size against their own equity — M9 never
// knows equity, so concrete sizes would be fake precision.
// Arch v2: M5-M8 are ADVISORS ONLY here — they may downgrade (cap) the risk
// tier but can never flip action/direction (that's the Board's job alone, see
// gate.ts). extreme_risk and lifecycle_invalidated used to be hard gate rungs;
// they are now advisory caps instead.

import type { MarketIntelligenceResult, QualityLevel, RiskLevel } from '../market/marketTypes';
import { PRIOR_TIER_CAP } from './config';
import type { RiskTier } from './decisionTypes';

const QUALITY_RANK: Record<QualityLevel, number> = { excellent: 4, good: 3, average: 2, poor: 1, dangerous: 0 };
const RISK_RANK: Record<RiskLevel, number> = { very_low: 0, low: 1, medium: 2, high: 3, extreme: 4 };
const TIER_RANK: Record<RiskTier, number> = { full: 3, half: 2, quarter: 1, none: 0 };

export type CapReason = 'prior' | 'extreme_risk' | 'lifecycle_invalidated' | null;

/** First-match ladder, then advisory caps (downgrade only, never upgrade). */
export function riskTierOf(
  market: MarketIntelligenceResult,
  gatePassed: boolean,
): { tier: RiskTier; capped: boolean; capReason: CapReason } {
  if (!gatePassed) return { tier: 'none', capped: false, capReason: null };

  if (market.risk.level === 'extreme') {
    return { tier: 'none', capped: true, capReason: 'extreme_risk' };
  }

  const q = QUALITY_RANK[market.quality.level];
  const r = RISK_RANK[market.risk.level];
  let tier: RiskTier;
  if (q >= QUALITY_RANK.excellent && r <= RISK_RANK.low) tier = 'full';
  else if (q >= QUALITY_RANK.good && r <= RISK_RANK.medium) tier = 'half';
  else tier = 'quarter';

  if (market.outlook.invalidation.invalidated && TIER_RANK[tier] > TIER_RANK.quarter) {
    return { tier: 'quarter', capped: true, capReason: 'lifecycle_invalidated' };
  }

  if (tier === 'full' && market.headline.calibration === 'prior') {
    return { tier: PRIOR_TIER_CAP, capped: true, capReason: 'prior' };
  }
  return { tier, capped: false, capReason: null };
}
