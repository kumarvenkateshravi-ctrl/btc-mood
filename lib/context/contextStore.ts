// One MarketContext for the whole app (MTFPlan Phase 12): the page computes it
// from candlesByTf and publishes here; the chart indicator, widget, dashboard,
// and future scanner/alerts/backtester all read the SAME object — no duplicate
// calculation. Plain module singleton (not React state): consumers that need
// reactivity already re-render on candle changes.

import type { MarketContext } from './types';

let _latest: MarketContext | null = null;

export function publishMarketContext(ctx: MarketContext): void {
  _latest = ctx;
}

export function latestMarketContext(): MarketContext | null {
  return _latest;
}

/** Test-only: reset the singleton. */
export function __resetContextForTest(): void {
  _latest = null;
}
