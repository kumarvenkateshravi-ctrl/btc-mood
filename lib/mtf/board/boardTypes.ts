// M-Board (Arch v2) — the SOLE source of trade direction in the platform.
// M0-M4 justify it (never decide); M5-M8 advise it (may only cap M9's risk
// tier, never flip direction). Built from the existing, independent
// lib/alignment.ts + lib/multiTimeframe.ts pipeline — structurally incapable
// of consuming M1-M4, which is what keeps "M0-M4 justify the Board" non-circular.
// Spec: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { MarketStructure } from '../../multiTimeframe';

export type BoardDirection = 'long' | 'short' | 'no_trade';

export interface BoardTrendStrength {
  /** 0-100, rescaled distance of the TF-weighted score from neutral (50). */
  score: number;
  label: 'weak' | 'moderate' | 'strong';
}

export interface BoardContributor {
  timeframe: Timeframe;
  /** Per-TF majority verdict (lib/alignment.ts computeTfCells). */
  verdict: Verdict;
  /** Per-TF 0-100 composite score. */
  score: number;
  /** TF_WEIGHT contribution to the weighted overall score. */
  weight: number;
}

/** Same {code,message,severity} shape as every other lib/mtf/ layer's signals
 *  (AgreementResult, ConfidenceResult, MarketIntelligenceResult, TradeDecisionResult)
 *  — kept consistent so BoardDecision isn't the one layer without it. */
export interface BoardSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
}

export interface BoardDecision {
  schemaVersion: 1;
  /** long/short/no_trade — echoed verbatim by M9, never recomputed downstream. */
  direction: BoardDirection;
  bias: Verdict;
  /** 0-100: agreement % discounted by dissent intensity (see boardEngine.ts). */
  conviction: number;
  trendStrength: BoardTrendStrength;
  marketStructure: MarketStructure;
  /** Fixed '5m' in this phase. */
  executionTimeframe: Timeframe;
  contributors: BoardContributor[];
  /** Empty when nothing to flag. BOARD_STRONG_DISSENT populated by boardEngine.ts. */
  warnings: BoardSignal[];
}
