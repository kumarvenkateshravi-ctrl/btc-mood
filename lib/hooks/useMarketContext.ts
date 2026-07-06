'use client';

// One MarketContext for the whole app: computed here from candlesByTf and
// published to the context store, where the chart indicator (decision gate),
// the context widget, and future consumers read the SAME object.
// buildMarketContext caches on a closed-bar signature, so per-tick re-renders
// are O(1) — only a bar close triggers real work.

import { useMemo } from 'react';
import type { Candle, Timeframe } from '../types';
import { buildMarketContext } from '../context/marketContext';
import { publishMarketContext } from '../context/contextStore';
import type { MarketContext } from '../context/types';

export function useMarketContext(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): MarketContext {
  return useMemo(() => {
    const ctx = buildMarketContext(candlesByTf);
    publishMarketContext(ctx);
    return ctx;
  }, [candlesByTf]);
}
