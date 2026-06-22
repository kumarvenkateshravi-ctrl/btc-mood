// Data source contract — the single seam through which every market-data
// request flows. Adding a new exchange / asset class is one class
// implementing `DataSource` + one `registerDataSource()` call.
//
// The interface is intentionally narrow: history (REST, server-side
// preferred), live kline stream (browser-direct WS), and an optional
// book ticker for bid/ask. Sources that can't support an operation
// simply omit that method (the protocol makes each one optional
// except the core two).

import type { Candle, Timeframe } from '../types';

export type DataSourceStatus = 'connecting' | 'open' | 'closed' | 'error' | 'idle';

export type DataSourceKind = 'crypto' | 'equity' | 'forex' | 'futures';

export interface DataSourceSymbol {
  /** Internal symbol key the source understands (e.g. 'BTCUSDT'). */
  symbol: string;
  /** Human-readable label for the UI (e.g. 'BTC / USDT'). */
  label: string;
}

export interface DataSourceMeta {
  /** Stable id used in URL params, registry keys, and persisted state. */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Exchange identifier (lowercase, e.g. 'binance', 'coinbase'). */
  exchange: string;
  /** Asset class — drives downstream defaults (color, sector grouping). */
  kind: DataSourceKind;
  /** Symbols pre-populated into the search datalist. */
  suggestedSymbols: ReadonlyArray<DataSourceSymbol>;
}

export interface FetchHistoryOptions {
  tf: Timeframe;
  symbol: string;
  /** Page size. Sources may clamp to their upstream max (e.g. Binance 1000). */
  limit?: number;
  /** End-time (ms, exclusive). Omit for the latest page. */
  before?: number;
  /** Caller-provided abort signal. */
  signal?: AbortSignal;
}

export interface SubscribeOptions {
  symbol: string;
  timeframes: Timeframe[];
  onBar: (bar: Candle, tf: Timeframe) => void;
  onStatus?: (s: DataSourceStatus) => void;
}

export interface BookTickerTick {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
}

/**
 * Every market-data source implements this. The registry keys by
 * `meta.id`. Two methods are required; the rest are optional.
 */
export interface DataSource {
  readonly meta: DataSourceMeta;

  /**
   * Fetch a page of historical candles. The default implementation
   * calls `/api/klines?source=<id>&...`; sources that need a different
   * transport (e.g. a non-HTTP upstream) can override.
   */
  fetchHistory(opts: FetchHistoryOptions): Promise<Candle[]>;

  /**
   * Subscribe to live kline bars for one symbol across the given
   * timeframes. Returns a disposer. Each `onBar` call carries the
   * current (possibly still-forming) bar; the chart decides whether
   * to update the last entry or push a new one.
   */
  subscribe(opts: SubscribeOptions): () => void;

  /** Best bid/ask. Optional — sources without an order book omit it. */
  subscribeBookTicker?(
    symbol: string,
    onTick: (t: BookTickerTick) => void,
    onStatus?: (s: DataSourceStatus) => void,
  ): () => void;

  /** Whether this source supports the given timeframe string. */
  supportsTimeframe(tf: Timeframe): boolean;
}
