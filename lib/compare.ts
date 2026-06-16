// Compare-mode support: a small set of tradable symbols on Binance
// spot that the dashboard can switch between.

export const COMPARE_SYMBOLS = [
  { symbol: 'BTCUSDT', label: 'BTC / USDT' },
  { symbol: 'ETHUSDT', label: 'ETH / USDT' },
  { symbol: 'SOLUSDT', label: 'SOL / USDT' },
] as const;

export type CompareSymbol = (typeof COMPARE_SYMBOLS)[number]['symbol'];

export const DEFAULT_COMPARE_SYMBOL: CompareSymbol = 'BTCUSDT';

export function isCompareSymbol(s: string): s is CompareSymbol {
  return COMPARE_SYMBOLS.some((c) => c.symbol === s);
}
