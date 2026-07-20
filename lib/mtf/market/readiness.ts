// M8 — Trade Readiness: an ENVIRONMENT GATE (Rule 6). Answers "is this
// environment worth engaging?" — it NEVER decides direction, entry, size, or RR
// (M9 owns those; M9 consumes this as an input). Four-rung first-match ladder;
// the reason names the deciding rule. Spec §Readiness.

import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import type { MarketGrade, QualityLevel, ReadinessState, RiskLevel } from './marketTypes';
import { READINESS } from './config';

const QUALITY_ORDER: QualityLevel[] = ['dangerous', 'poor', 'average', 'good', 'excellent'];
const GRADE_ORDER: MarketGrade[] = ['F', 'D', 'C', 'B', 'A', 'A+'];
const RISK_ORDER: RiskLevel[] = ['very_low', 'low', 'medium', 'high', 'extreme'];

export function tradeReadiness(
  quality: { score: number; level: QualityLevel; reasons: string[] },
  opportunity: { score: number; grade: MarketGrade },
  risk: { score: number; level: RiskLevel; reasons: string[] },
  hierarchy: HierarchyResult,
  probability: ProbabilityResult,
): { state: ReadinessState; reason: string } {
  // 1. avoid — hostile environment
  if (RISK_ORDER.indexOf(risk.level) > RISK_ORDER.indexOf(READINESS.maxRisk))
    return { state: 'avoid', reason: `${risk.level} environment risk` };
  if (quality.level === 'dangerous') return { state: 'avoid', reason: 'dangerous market quality' };
  if (hierarchy.overallMarketState === 'reversal_risk') return { state: 'avoid', reason: 'reversal risk' };

  // 2. no_trade — nothing to engage with
  if (quality.level === 'poor') return { state: 'no_trade', reason: 'poor market quality' };
  if (probability.dominantDirection.direction === 'sideways')
    return { state: 'no_trade', reason: 'sideways market — no directional edge' };

  // 3. ready — thresholds met
  if (
    QUALITY_ORDER.indexOf(quality.level) >= QUALITY_ORDER.indexOf(READINESS.minQuality) &&
    GRADE_ORDER.indexOf(opportunity.grade) >= GRADE_ORDER.indexOf(READINESS.minGrade)
  ) {
    return { state: 'ready', reason: `quality ${quality.level}, opportunity ${opportunity.grade}, risk ${risk.level}` };
  }

  // 4. wait — needs confirmation
  return { state: 'wait', reason: 'awaiting confirmation — quality or opportunity below thresholds' };
}
