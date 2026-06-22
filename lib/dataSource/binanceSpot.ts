// Binance Spot DataSource — the first implementation of the registry
// protocol. Wraps the existing `lib/fetcher.ts` and `lib/ws.ts` so the
// proven REST + WS plumbing is reused verbatim. The protocol surface
// is added above; the underlying logic is unchanged.

import {
  fetchKlinesTyped,
  fetchKlinesBefore,
  KlinesError,
  RateLimitedError,
} from '../fetcher';
import { subscribeKlines, subscribeBookTicker } from '../ws';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { COMPARE_SYMBOLS } from '../compare';
import type {
  BookTickerTick,
  DataSource,
  DataSourceStatus,
  FetchHistoryOptions,
  SubscribeOptions,
} from './types';

const ID = 'binance-spot';

function mapStatus(s: 'connecting' | 'open' | 'closed' | 'error'): DataSourceStatus {
  return s;
}

export class BinanceSpotSource implements DataSource {
  readonly meta = {
    id: ID,
    label: 'Binance Spot',
    exchange: 'binance',
    kind: 'crypto' as const,
    suggestedSymbols: COMPARE_SYMBOLS,
  };

  async fetchHistory(opts: FetchHistoryOptions): Promise<Candle[]> {
    if (opts.before != null) {
      return fetchKlinesBefore(
        opts.tf,
        // The /api/klines route's symbol validation still uses
        // isCompareSymbol — pass the upper-cased key; the route
        // accepts anything in COMPARE_SYMBOLS.
        opts.symbol as never,
        opts.before,
        opts.limit ?? 1000,
        opts.signal,
      );
    }
    return fetchKlinesTyped(
      opts.tf,
      opts.symbol as never,
      opts.signal,
    );
  }

  subscribe(opts: SubscribeOptions): () => void {
    return subscribeKlines(
      opts.symbol,
      opts.timeframes,
      opts.onBar,
      opts.onStatus ? (s) => opts.onStatus!(mapStatus(s)) : undefined,
    );
  }

  subscribeBookTicker(
    symbol: string,
    onTick: (t: BookTickerTick) => void,
    onStatus?: (s: DataSourceStatus) => void,
  ): () => void {
    return subscribeBookTicker(
      symbol,
      (t) => onTick({ bid: t.bid, ask: t.ask, bidQty: t.bidQty, askQty: t.askQty }),
      onStatus ? (s) => onStatus(mapStatus(s)) : undefined,
    );
  }

  supportsTimeframe(tf: Timeframe): boolean {
    return (TIMEFRAMES as string[]).includes(tf);
  }
}

// Re-export the typed errors so consumers can use a single import
// surface when working with the registry.
export { KlinesError, RateLimitedError };
