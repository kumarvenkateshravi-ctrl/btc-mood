// DataSource package entrypoint. Importing this file auto-registers
// the built-in Binance Spot source. New sources (Coinbase, Kraken,
// yfinance, …) plug in by writing one class and calling
// `registerDataSource()` from this file.

import { registerDataSource, setDefaultDataSourceId } from './registry';
import { BinanceSpotSource } from './binanceSpot';

export const DEFAULT_DATA_SOURCE_ID = 'binance-spot';

registerDataSource(new BinanceSpotSource());
setDefaultDataSourceId(DEFAULT_DATA_SOURCE_ID);

export type {
  DataSource,
  DataSourceMeta,
  DataSourceKind,
  DataSourceSymbol,
  DataSourceStatus,
  FetchHistoryOptions,
  SubscribeOptions,
  BookTickerTick,
} from './types';

export {
  registerDataSource,
  getDataSource,
  hasDataSource,
  listDataSources,
  listDataSourceMetas,
  defaultDataSource,
  setDefaultDataSourceId,
} from './registry';

export { BinanceSpotSource } from './binanceSpot';
