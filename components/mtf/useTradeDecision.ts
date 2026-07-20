'use client';

// MTF Intelligence UI (Phase 1c) — M9 decision hook. Reuses the page's
// already-computed FullMarketIntelligence (never re-runs the stack) and the
// page's closed-bar-cached smcByTf; recomputes only on the closed-bar
// signature + the SMC toggle (indicator-tick-perf discipline — never on ticks).
// Spec: docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1c-design.md

import { useMemo } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import type { SmcSnapshot } from '@/lib/smc/types';
import type { FullMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import { computeTradeDecision, executionTimeframeOf } from '@/lib/mtf/decision/decisionEngine';
import type { TradeDecisionResult } from '@/lib/mtf/decision/decisionTypes';

/** Pure core (exported for tests): pick the execution TF's snapshot iff enabled. */
export function decideWithSmc(
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  const executionTf = executionTimeframeOf(full.layers.hierarchy);
  const smc = smcEnabled ? smcByTf[executionTf] : undefined;
  return computeTradeDecision(full, candlesByTf, smc);
}

export function useTradeDecision(
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  // Signature over last-CLOSED bar per TF (last bar is still forming).
  const fullSig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on closed bars + toggle
  return useMemo(() => decideWithSmc(full, candlesByTf, smcByTf, smcEnabled), [full, fullSig, smcByTf, smcEnabled]);
}
