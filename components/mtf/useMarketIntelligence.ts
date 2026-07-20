'use client';

// MTF Intelligence UI (Phase 1b) — memoized data hook, now fed by M8's single
// entry point. Runs the FULL frozen M0–M8 stack at most ONCE per closed bar
// (never on ticks — indicator-tick-perf discipline), plus the per-selected-TF
// M1–M4 bundle for the interactive panels.
// Spec: docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1b-design.md

import { useMemo } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import { computeFullMarketIntelligence, type FullMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import {
  computeSelectedTimeframeBundle, deriveTradeContext,
  type SelectedTimeframeBundle, type TradeContext,
} from '@/lib/mtf/marketIntelligence';

export function useMarketIntelligence(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  selectedTf: Timeframe,
): { full: FullMarketIntelligence; selected: SelectedTimeframeBundle | null; tradeContext: TradeContext } {
  // Signature over last-CLOSED bar per TF (last bar is still forming).
  const fullSig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the closed-bar signature
  const full = useMemo(() => computeFullMarketIntelligence(candlesByTf), [fullSig]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the closed-bar signature + selection
  const selected = useMemo(() => computeSelectedTimeframeBundle(candlesByTf, selectedTf), [fullSig, selectedTf]);
  const tradeContext = useMemo(
    () => deriveTradeContext(full.layers.hierarchy, selected?.confidence.confidence ?? 0),
    [full, selected],
  );
  return { full, selected, tradeContext };
}
