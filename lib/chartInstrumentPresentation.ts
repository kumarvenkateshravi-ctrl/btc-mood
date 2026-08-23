import { formatNumber } from './format';

export type ChartInstrumentKind = 'crypto' | 'metal' | 'generic';

export interface ChartInstrumentPresentation {
  symbol: string;
  label: string;
  displaySymbol: string;
  kind: ChartInstrumentKind;
  pricePrecision: number;
  priceMinMove: number;
}

/**
 * Presentation-only policy for the focused chart instruments. It deliberately
 * does not decide data-source ownership, execution semantics, or symbol
 * identity. Unknown symbols receive a neutral safe fallback instead of BTC
 * presentation assumptions.
 */
export const CHART_INSTRUMENTS: readonly ChartInstrumentPresentation[] = [
  { symbol: 'BTCUSDT', label: 'BTC', displaySymbol: 'BTCUSDT', kind: 'crypto', pricePrecision: 2, priceMinMove: 0.1 },
  { symbol: 'XAUUSD', label: 'Gold', displaySymbol: 'XAUUSD', kind: 'metal', pricePrecision: 2, priceMinMove: 0.01 },
] as const;

const FALLBACK_INSTRUMENT: Omit<ChartInstrumentPresentation, 'symbol' | 'label' | 'displaySymbol'> = {
  kind: 'generic',
  pricePrecision: 2,
  priceMinMove: 0.01,
};

export function getChartInstrumentPresentation(symbol: string): ChartInstrumentPresentation {
  return CHART_INSTRUMENTS.find((instrument) => instrument.symbol === symbol) ?? {
    ...FALLBACK_INSTRUMENT,
    symbol,
    label: symbol,
    displaySymbol: symbol,
  };
}

export function formatChartInstrumentPrice(symbol: string, price: number): string {
  const instrument = getChartInstrumentPresentation(symbol);
  return formatNumber(price, { currency: 'USD', precision: instrument.pricePrecision });
}

export function getChartPriceFormat(symbol: string) {
  const instrument = getChartInstrumentPresentation(symbol);
  return {
    type: 'price' as const,
    precision: instrument.pricePrecision,
    minMove: instrument.priceMinMove,
  };
}