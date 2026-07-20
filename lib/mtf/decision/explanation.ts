// M9 — explanation. Deterministic template sentences framing the setup as a
// CONDITIONAL PROPOSAL, never a prediction: the stop IS the invalidation.
// All wording must clear the banned-predictive-vocabulary test.

import type { Timeframe } from '../../types';
import type { GateResult, RiskTier, TradeAction, TradeSetup } from './decisionTypes';

export function explain(args: {
  action: TradeAction;
  gate: GateResult;
  executionTf: Timeframe;
  setup: TradeSetup | null;
  tier: RiskTier;
  capped: boolean;
  calibration: 'prior' | 'empirical';
}): string[] {
  const { action, gate, executionTf, setup, tier, capped } = args;
  if (action === 'no_trade' || !setup) {
    return [`No trade: ${gate.reason}.`];
  }
  const [lo, hi] = setup.entry.zone;
  const t1 = setup.targets[0];
  return [
    `Setup proposed on ${executionTf}: ${action} entry ${lo}–${hi} (${setup.entry.type}), ` +
      `stop ${setup.stop.price} (${setup.stop.distancePct}%), first target ${t1.price} (RR ${setup.rr}).`,
    `Invalid ${action === 'long' ? 'below' : 'above'} ${setup.stop.price} — the stop is the invalidation.`,
    `Risk tier: ${tier}.${capped ? ' Capped while probabilities run on model priors.' : ''}`,
  ];
}
