// M9 — Trade Decision orchestrator. The first ACTIONABLE layer: consumes the
// Board's direction (Arch v2 — the SOLE source of LONG/SHORT/NO_TRADE) plus the
// frozen M8 output (never recomputing lower layers, used only to explain and to
// cap risk tier), prices the setup on the Board's execution timeframe's closed
// bars, optionally refines via bounded SMC confluence, re-checks RR after
// refinement, and assigns a risk tier.
// Spec: docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md
// Arch v2: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import { TIMEFRAMES, type Candle, type Timeframe } from '../../types';
import type { SmcSnapshot } from '../../smc/types';
import { computeAlignmentMatrix } from '../../alignment';
import { computeConsensus, computeWeightedScore } from '../../multiTimeframe';
import { computeBoardDecision } from '../board/boardEngine';
import type { BoardDecision } from '../board/boardTypes';
import { computeFullMarketIntelligence, type FullMarketIntelligence } from '../market/marketEngine';
import type { MarketIntelligenceResult } from '../market/marketTypes';
import { DECISION_CONFIG } from './config';
import type {
  ConfluenceNote, DecisionSignal, GateResult, TradeDecisionResult, TradeSetup, TradeSide,
} from './decisionTypes';
import { boardGate } from './gate';
import { buildSetup } from './levels';
import { riskTierOf } from './riskTier';
import { applySmcConfluence } from './smcConfluence';
import { explain } from './explanation';

export const DECISION_SCHEMA_VERSION = 1;

/** Drop the still-forming last bar (closed-bar determinism). */
const closed = (c: Candle[]): Candle[] => (c.length > 1 ? c.slice(0, -1) : c);

interface AssembleArgs {
  board: BoardDecision;
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
  const { board, market, gate, executionTf, setup, side, confluence, extraWarnings, diagnostics } = args;
  const action = gate.passed && setup && side ? side : 'no_trade';
  const calibration = market.headline.calibration;
  const { tier, capped, capReason } = riskTierOf(market, action !== 'no_trade');
  const signals: DecisionSignal[] = [];
  if (calibration === 'prior') {
    signals.push({
      code: 'DECISION_MODEL_PRIORS', severity: 'info',
      message: 'Probabilities behind this decision come from model priors, not measured frequencies',
    });
  }
  if (capped && capReason === 'prior') {
    signals.push({
      code: 'TIER_CAPPED_PRIOR', severity: 'info',
      message: 'Risk tier capped at half while probabilities run on model priors',
    });
  } else if (capped && capReason === 'extreme_risk') {
    signals.push({
      code: 'TIER_CAPPED_RISK', severity: 'warning',
      message: 'Risk tier capped to none — market risk is extreme (advisory only; board direction unchanged)',
    });
  } else if (capped && capReason === 'lifecycle_invalidated') {
    signals.push({
      code: 'TIER_CAPPED_LIFECYCLE', severity: 'warning',
      message: 'Risk tier capped to quarter — trend lifecycle is invalidated (advisory only; board direction unchanged)',
    });
  }
  return {
    schemaVersion: 1,
    action,
    gate,
    direction: board.bias,
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
  board: BoardDecision,
  intel: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): TradeDecisionResult {
  const market = intel.result;
  const executionTf = board.executionTimeframe;
  const side: TradeSide | null = board.direction === 'no_trade' ? null : board.direction;
  const emptyDiag = { atr: null, swingHigh: null, swingLow: null, rawRR: null };

  const gate = boardGate(board);
  if (!gate.passed || !side) {
    return assembleResult({
      board, market, gate, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
    });
  }

  const candles = closed(candlesByTf[executionTf] ?? []);
  if (candles.length < DECISION_CONFIG.minCandles) {
    return assembleResult({
      board, market, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
      gate: {
        passed: false, blockedBy: 'insufficient_data',
        reason: 'not enough closed candles on the execution timeframe',
      },
    });
  }

  const out = buildSetup(side, candles);
  if (out.kind === 'block') {
    return assembleResult({
      board, market, executionTf, setup: null, side, confluence: [], extraWarnings: [],
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
        board, market, executionTf, setup: null, side, confluence, extraWarnings,
        diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: setup.rr },
        gate: {
          passed: false, blockedBy: 'rr_too_low',
          reason: `reward-to-risk ${setup.rr} after confluence refinement is below the ${DECISION_CONFIG.minRR} minimum`,
        },
      });
    }
  }

  return assembleResult({
    board, market, gate, executionTf, setup, side, confluence, extraWarnings,
    diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: null },
  });
}

/** Convenience entry point: candles → Board + the entire frozen M0–M8 stack → decision. */
export function computeFullTradeDecision(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): { decision: TradeDecisionResult; intel: FullMarketIntelligence; board: BoardDecision } {
  const tfs = [...TIMEFRAMES];
  const matrix = computeAlignmentMatrix(candlesByTf, tfs);
  const consensus = computeConsensus(matrix, tfs);
  const weighted = computeWeightedScore(matrix, tfs);
  const board = computeBoardDecision(matrix, consensus, weighted, candlesByTf);
  const intel = computeFullMarketIntelligence(candlesByTf);
  return { decision: computeTradeDecision(board, intel, candlesByTf, smc), intel, board };
}
