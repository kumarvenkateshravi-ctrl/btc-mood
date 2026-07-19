'use client';

// MTF Intelligence UI (Phase 1) — memoized data hook. Runs the heavy M2–M5 stack
// (6 timeframes × full pipeline) at most ONCE per closed bar by keying the memo on
// each TF's last-closed-bar time — never on ticks (indicator-tick-perf discipline).
// Spec: docs/superpowers/specs/2026-07-19-mtf-intelligence-ui-phase1-design.md

import { useMemo } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import {
  computeMarketIntelligenceBoard, deriveTradeContext,
  type MarketIntelligenceBoard, type TradeContext,
} from '@/lib/mtf/marketIntelligence';

export function useMarketIntelligence(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  selectedTf: Timeframe,
): { board: MarketIntelligenceBoard; tradeContext: TradeContext } {
  // Signature over last-CLOSED bar per TF (last bar is still forming) + selected TF.
  const sig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|') + `#${selectedTf}`;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the closed-bar signature
  const board = useMemo(() => computeMarketIntelligenceBoard(candlesByTf, selectedTf), [sig]);
  const tradeContext = useMemo(() => deriveTradeContext(board.hierarchy, board.selected?.confidence.confidence ?? 0), [board]);
  return { board, tradeContext };
}
