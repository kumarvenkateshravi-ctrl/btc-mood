import type { WSStatus } from './ws';

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
}: MarketDataIntegrityInput): MarketDataIntegrity {
  if (replayActive) return 'replay';
  if (demo) return 'demo';
  if (!hasAnyCandles) return isLoading ? 'loading' : 'unavailable';
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
