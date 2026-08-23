import type { WSStatus } from './ws';
import { summarizeFeedHealth, type FeedHealthSnapshot } from './marketData/feedHealth';

/**
 * The provenance/freshness of the dashboard's market data.  This is kept
 * intentionally small: it tells consumers whether they may use a displayed
 * price for live execution, without changing candle rendering or indicators.
 */
export type MarketDataIntegrity =
  | 'loading'
  | 'historical'
  | 'live'
  | 'stale'
  | 'partial'
  | 'unavailable'
  | 'replay'
  | 'demo';

export interface MarketDataIntegrityInput {
  hasAnyCandles: boolean;
  hasAllTimeframes: boolean;
  hasErrors: boolean;
  isLoading: boolean;
  wsStatus: WSStatus;
  lastUpdateMs: number;
  nowMs: number;
  staleAfterMs?: number;
  replayActive?: boolean;
  demo?: boolean;
  /** Optional Stage 3 evidence; without it the legacy derivation is retained. */
  feedHealth?: FeedHealthSnapshot;
}

export const MARKET_DATA_STALE_AFTER_MS = 15_000;

export function deriveMarketDataIntegrity({
  hasAnyCandles,
  hasAllTimeframes,
  hasErrors,
  isLoading,
  wsStatus,
  lastUpdateMs,
  nowMs,
  staleAfterMs = MARKET_DATA_STALE_AFTER_MS,
  replayActive = false,
  demo = false,
  feedHealth,
}: MarketDataIntegrityInput): MarketDataIntegrity {
  if (replayActive) return 'replay';
  if (demo) return 'demo';
  if (!hasAnyCandles) return isLoading ? 'loading' : 'unavailable';
  if (feedHealth) {
    const health = summarizeFeedHealth(feedHealth, nowMs, staleAfterMs);
    if (!hasAllTimeframes) return 'partial';
    if (health.anyRequiredKlineUnavailable) return health.hasLiveSynchronizationAttempt ? 'partial' : 'historical';
    if (hasErrors || health.anyRequiredKlineStale) return 'stale';
    if (health.anyRequiredKlineSynchronizing || !health.allRequiredKlinesLive || !health.tickerLive) {
      return health.hasLiveSynchronizationAttempt ? 'partial' : 'historical';
    }
    return 'live';
  }
  if (hasErrors && !hasAllTimeframes) return 'partial';
  if (!hasAllTimeframes) return 'partial';
  if (hasErrors) return 'stale';
  if (wsStatus !== 'open') return 'historical';
  if (lastUpdateMs <= 0 || nowMs - lastUpdateMs > staleAfterMs) return 'stale';
  return 'live';
}

/** A live order/close needs a current, independently refreshed market price. */
export function isPriceExecutionTrusted(integrity: MarketDataIntegrity): boolean {
  return integrity === 'live';
}
