'use client';

// MTF Intelligence UI (Phase 1b) — memoized data hook, now fed by M8's single
// entry point. Runs the FULL frozen M0–M8 stack at most ONCE per closed bar
// (never on ticks — indicator-tick-perf discipline), plus the per-selected-TF
// M1–M4 bundle for the interactive panels.
// Spec: docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1b-design.md
//
// Arch v2 follow-up (2026-07-25): `full` is now computed on 5m candles ONLY,
// so M6/M7/M8's own internal controller/lifecycle/probability describe the SAME
// timeframe the Board/M9 execute on — before this fix M8's controller could
// float to any TF (e.g. 15m/4h), showing risk/readiness for a timeframe that
// had nothing to do with the trade being priced. `crossTf` keeps the ORIGINAL
// full 6-TF cross-sectional computation, used only where a genuine multi-TF
// view is the point (the Hierarchy panel, and TradeContext's htfBias read).
// Spec: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

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
): {
  full: FullMarketIntelligence;
  crossTf: FullMarketIntelligence;
  selected: SelectedTimeframeBundle | null;
  tradeContext: TradeContext;
} {
  // Signature over last-CLOSED bar per TF (last bar is still forming).
  const fullSig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|');
  const exec5mSig = (() => {
    const a = candlesByTf['5m'];
    return a && a.length > 1 ? `5m:${a[a.length - 2].time}` : '5m:0';
  })();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the 5m closed-bar signature
  const full = useMemo(() => computeFullMarketIntelligence({ '5m': candlesByTf['5m'] ?? [] }), [exec5mSig]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the closed-bar signature
  const crossTf = useMemo(() => computeFullMarketIntelligence(candlesByTf), [fullSig]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the closed-bar signature + selection
  const selected = useMemo(() => computeSelectedTimeframeBundle(candlesByTf, selectedTf), [fullSig, selectedTf]);
  const tradeContext = useMemo(
    () => deriveTradeContext(crossTf.layers.hierarchy, selected?.confidence.confidence ?? 0),
    [crossTf, selected],
  );
  return { full, crossTf, selected, tradeContext };
}
