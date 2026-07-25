// M9 — Trade Decision contract. The first ACTIONABLE layer: M0–M8 describe the
// market; M9 gates, translates, and prices M8's conclusion into a conditional
// setup proposal. NOT execution: no orders, no account, no equity. Never
// recomputes or overrides the frozen layers below.
// Spec: docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { BoardDirection } from '../board/boardTypes';

/** = BoardDirection. M9 never invents its own action union — the Board (Arch v2's
 *  sole direction authority) is upstream of M9, so M9's type is derived from it. */
export type TradeAction = BoardDirection;
export type TradeSide = Exclude<TradeAction, 'no_trade'>;
export type RiskTier = 'full' | 'half' | 'quarter' | 'none';
export type EntryType = 'market' | 'pullback';
export type LevelSource = 'atr' | 'swing' | 'smc_orderblock' | 'smc_fvg' | 'smc_liquidity';

/** Every price carries its named source — the levels analogue of the M4/M7 audit identity. */
export interface PriceLevel {
  price: number;
  source: LevelSource;
  description: string;
}

/** One bounded SMC adjustment to the core setup — what changed, from what, to what. */
export interface ConfluenceNote {
  code: string;
  message: string;
  field: 'entry' | 'stop' | 'target';
  before: number;
  after: number;
}

export interface DecisionSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
}

export interface GateResult {
  passed: boolean;
  /** Stable code of the first-match rung that blocked, null when passed. */
  blockedBy: string | null;
  reason: string;
}

export interface TradeSetup {
  entry: { zone: [number, number]; type: EntryType; basis: PriceLevel };
  stop: PriceLevel & { distancePct: number };
  /** [structural, measured] or [measured] when no structural obstacle exists. */
  targets: Array<PriceLevel & { rr: number }>;
  /** RR to targets[0] — the honest headline number. */
  rr: number;
  /** Audit: the ATR every level was built from. */
  atr: number;
}

export interface TradeDecisionResult {
  schemaVersion: 1;
  action: TradeAction;
  gate: GateResult;
  /** Echoed from BoardDecision.bias — NEVER recomputed (Arch v2: the Board is
   *  the sole direction authority; M0-M8 only explain/advise). */
  direction: Verdict;
  executionTf: Timeframe;
  /** null ⟺ action === 'no_trade'. */
  setup: TradeSetup | null;
  /** 'none' ⟺ action === 'no_trade'. */
  riskTier: RiskTier;
  /** Empty without an SMC input. */
  confluence: ConfluenceNote[];
  /** Propagated from M8, never hidden. */
  calibration: 'prior' | 'empirical';
  explanation: string[];
  signals: DecisionSignal[];
  warnings: DecisionSignal[];
  diagnostics: {
    schemaVersions: { market: number };
    atr: number | null;
    swingHigh: number | null;
    swingLow: number | null;
    /** RR that a rejection decision was based on (rung 7), null otherwise. */
    rawRR: number | null;
    smcApplied: boolean;
  };
}
