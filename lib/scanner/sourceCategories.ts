// Grand-plan indicator taxonomy (Strategy Studio M3): the condition picker
// groups sources the way traders think — never alphabetically.

import type { ScannerSource } from './types';

export type SourceCategory =
  | 'price' | 'trend' | 'momentum' | 'volume' | 'volatility' | 'structure' | 'smc' | 'intelligence';

export const CATEGORY_ORDER: Array<{ id: SourceCategory; label: string }> = [
  { id: 'price', label: 'Price' },
  { id: 'trend', label: 'Trend' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'volume', label: 'Volume' },
  { id: 'volatility', label: 'Volatility' },
  { id: 'structure', label: 'Market Structure' },
  { id: 'smc', label: 'Smart Money' },
  { id: 'intelligence', label: 'Intelligence' },
];

const EXPLICIT: Record<string, SourceCategory> = {
  price: 'price',
  ema: 'trend',
  sma: 'trend',
  supertrend: 'trend',
  rsi: 'momentum',
  macd: 'momentum',
  adx: 'momentum',
  stochastic: 'momentum',
  vwap: 'volume',
  volume: 'volume',
  obv: 'volume',
  atr: 'volatility',
  bollinger: 'volatility',
  structure: 'structure',
  smc_structure: 'smc',
  smc_liquidity: 'smc',
  smc_orderblock: 'smc',
  smc_state: 'smc',
};

export function categoryOf(source: Pick<ScannerSource, 'id' | 'group'>): SourceCategory {
  const explicit = EXPLICIT[source.id];
  if (explicit) return explicit;
  if (source.id.startsWith('smc_')) return 'smc';
  if (source.group === 'structure') return 'structure';
  if (source.group === 'intelligence') return 'intelligence';
  return 'trend';
}
