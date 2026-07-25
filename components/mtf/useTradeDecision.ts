'use client';

// MTF Intelligence UI (Phase 1c) — M9 decision hook. Reuses the page's
// already-computed Board decision (Arch v2's sole direction authority) and
// FullMarketIntelligence (never re-runs either stack) plus the page's
// closed-bar-cached smcByTf; recomputes only on the closed-bar signature + the
// SMC toggle (indicator-tick-perf discipline — never on ticks).
// Spec: docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1c-design.md
// Arch v2: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import { useMemo } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import type { SmcSnapshot } from '@/lib/smc/types';
import type { BoardDecision } from '@/lib/mtf/board/boardTypes';
import type { FullMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import { computeTradeDecision } from '@/lib/mtf/decision/decisionEngine';
import type { TradeDecisionResult } from '@/lib/mtf/decision/decisionTypes';

/** Pure core (exported for tests): pick the Board's execution TF's snapshot iff enabled. */
export function decideWithSmc(
  board: BoardDecision,
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  const smc = smcEnabled ? smcByTf[board.executionTimeframe] : undefined;
  return computeTradeDecision(board, full, candlesByTf, smc);
}

export function useTradeDecision(
  board: BoardDecision,
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  // Signature over last-CLOSED bar per TF (last bar is still forming).
  const fullSig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on closed bars + toggle + board
  return useMemo(() => decideWithSmc(board, full, candlesByTf, smcByTf, smcEnabled), [board, full, fullSig, smcByTf, smcEnabled]);
}
