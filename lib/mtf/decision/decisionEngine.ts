// M9 — Trade Decision orchestrator. The first ACTIONABLE layer: consumes the
// frozen M8 output (never recomputing lower layers), prices the setup on the
// execution timeframe's closed bars, optionally refines via bounded SMC
// confluence, re-checks RR after refinement, and assigns a risk tier.
// Spec: docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md

import type { Candle, Timeframe } from '../../types';
import type { SmcSnapshot } from '../../smc/types';
import { computeFullMarketIntelligence, type FullMarketIntelligence } from '../market/marketEngine';
import type { MarketIntelligenceResult } from '../market/marketTypes';
import { tfWeight } from '../timeframe/config';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import { DECISION_CONFIG } from './config';
import type {
  ConfluenceNote, DecisionSignal, GateResult, TradeDecisionResult, TradeSetup, TradeSide,
} from './decisionTypes';
import { environmentGate } from './gate';
import { buildSetup } from './levels';
import { riskTierOf } from './riskTier';
import { applySmcConfluence } from './smcConfluence';
import { explain } from './explanation';

export const DECISION_SCHEMA_VERSION = 1;

/** Drop the still-forming last bar (closed-bar determinism). */
const closed = (c: Candle[]): Candle[] => (c.length > 1 ? c.slice(0, -1) : c);

/** Execution TF: highest-authority trigger → else lowest-weight entry → else
 *  controller (deliberate mirror of deriveTradeContext's selection). Exported so
 *  UI hooks can select the execution TF's SmcSnapshot before calling the engine. */
export function executionTimeframeOf(hierarchy: HierarchyResult): Timeframe {
  const entries = Object.values(hierarchy.perTimeframe).filter((e): e is NonNullable<typeof e> => !!e);
  const triggers = entries.filter((e) => e.role === 'trigger');
  if (triggers.length) return triggers.reduce((b, e) => (e.authority > b.authority ? e : b)).timeframe;
  if (entries.length) return entries.reduce((b, e) => (tfWeight(e.timeframe) < tfWeight(b.timeframe) ? e : b)).timeframe;
  return hierarchy.controller;
}

interface AssembleArgs {
  market: MarketIntelligenceResult;
  gate: GateResult;
  executionTf: Timeframe;
  setup: TradeSetup | null;
  side: TradeSide | null;
  confluence: ConfluenceNote[];
  extraWarnings: DecisionSignal[];
  diagnostics: { atr: number | null; swingHigh: number | null; swingLow: number | null; rawRR: number | null };
}

function assembleResult(args: AssembleArgs): TradeDecisionResult {
  const { market, gate, executionTf, setup, side, confluence, extraWarnings, diagnostics } = args;
  const action = gate.passed && setup && side ? side : 'no_trade';
  const calibration = market.headline.calibration;
  const { tier, capped } = riskTierOf(market, action !== 'no_trade');
  const signals: DecisionSignal[] = [];
  if (calibration === 'prior') {
    signals.push({
      code: 'DECISION_MODEL_PRIORS', severity: 'info',
      message: 'Probabilities behind this decision come from model priors, not measured frequencies',
    });
  }
  if (capped) {
    signals.push({
      code: 'TIER_CAPPED_PRIOR', severity: 'info',
      message: 'Risk tier capped at half while probabilities run on model priors',
    });
  }
  return {
    schemaVersion: 1,
    action,
    gate,
    direction: market.headline.bias,
    executionTf,
    setup: action === 'no_trade' ? null : setup,
    riskTier: tier,
    confluence,
    calibration,
    explanation: explain({
      action, gate, executionTf, setup: action === 'no_trade' ? null : setup, tier, capped, calibration,
    }),
    signals,
    warnings: extraWarnings,
    diagnostics: {
      schemaVersions: { market: market.schemaVersion },
      ...diagnostics,
      smcApplied: confluence.length > 0,
    },
  };
}

export function computeTradeDecision(
  intel: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): TradeDecisionResult {
  const market = intel.result;
  const executionTf = executionTimeframeOf(intel.layers.hierarchy);
  const side: TradeSide | null =
    market.headline.bias === 'bullish' ? 'long' : market.headline.bias === 'bearish' ? 'short' : null;
  const emptyDiag = { atr: null, swingHigh: null, swingLow: null, rawRR: null };

  const env = environmentGate(market);
  if (!env.passed || !side) {
    return assembleResult({
      market, gate: env, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
    });
  }

  const candles = closed(candlesByTf[executionTf] ?? []);
  if (candles.length < DECISION_CONFIG.minCandles) {
    return assembleResult({
      market, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
      gate: {
        passed: false, blockedBy: 'insufficient_data',
        reason: 'not enough closed candles on the execution timeframe',
      },
    });
  }

  const out = buildSetup(side, candles);
  if (out.kind === 'block') {
    return assembleResult({
      market, executionTf, setup: null, side, confluence: [], extraWarnings: [],
      diagnostics: { atr: null, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: out.rawRR },
      gate: {
        passed: false, blockedBy: out.block,
        reason: out.block === 'rr_too_low'
          ? `reward-to-risk ${out.rawRR} is below the ${DECISION_CONFIG.minRR} minimum`
          : 'no reliable anchoring swing structure on the execution timeframe',
      },
    });
  }

  let setup = out.setup;
  let confluence: ConfluenceNote[] = [];
  let extraWarnings: DecisionSignal[] = [];
  if (smc) {
    const refined = applySmcConfluence(setup, side, out.lastClose, smc.objects);
    setup = refined.setup;
    confluence = refined.notes;
    extraWarnings = refined.warnings;
    // RR re-gate: refinement (stop extension) can lower RR below the minimum.
    if (setup.rr < DECISION_CONFIG.minRR) {
      return assembleResult({
        market, executionTf, setup: null, side, confluence, extraWarnings,
        diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: setup.rr },
        gate: {
          passed: false, blockedBy: 'rr_too_low',
          reason: `reward-to-risk ${setup.rr} after confluence refinement is below the ${DECISION_CONFIG.minRR} minimum`,
        },
      });
    }
  }

  return assembleResult({
    market, gate: env, executionTf, setup, side, confluence, extraWarnings,
    diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: null },
  });
}

/** Convenience entry point: candles → the entire frozen M0–M8 stack → decision. */
export function computeFullTradeDecision(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): { decision: TradeDecisionResult; intel: FullMarketIntelligence } {
  const intel = computeFullMarketIntelligence(candlesByTf);
  return { decision: computeTradeDecision(intel, candlesByTf, smc), intel };
}
