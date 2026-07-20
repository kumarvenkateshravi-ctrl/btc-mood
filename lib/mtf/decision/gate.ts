// M9 — environment gate. First-match no-trade ladder over M8's verdicts.
// M9 DEFERS to M8's environment gate: only readiness 'ready' can pass, and a
// non-ready block carries M8's reason verbatim — M9 never second-guesses it.
// Structural/pricing rungs (insufficient_data / insufficient_structure /
// rr_too_low) are composed by the orchestrator after pricing.

import type { MarketIntelligenceResult } from '../market/marketTypes';
import type { GateResult } from './decisionTypes';

export function environmentGate(market: MarketIntelligenceResult): GateResult {
  const { readiness, headline, risk, outlook } = market;
  if (readiness.state !== 'ready') {
    return { passed: false, blockedBy: `environment_${readiness.state}`, reason: readiness.reason };
  }
  if (headline.bias === 'neutral') {
    return { passed: false, blockedBy: 'no_directional_edge', reason: 'headline bias is neutral — no directional edge' };
  }
  if (risk.level === 'extreme') {
    return { passed: false, blockedBy: 'extreme_risk', reason: 'market risk is extreme' };
  }
  if (outlook.invalidation.invalidated) {
    return { passed: false, blockedBy: 'lifecycle_invalidated', reason: 'trend lifecycle stage is invalidated' };
  }
  return { passed: true, blockedBy: null, reason: readiness.reason };
}
