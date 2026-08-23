import { describe, expect, it } from 'vitest';
import {
  CHART_INSTRUMENTS,
  formatChartInstrumentPrice,
  getChartInstrumentPresentation,
  getChartPriceFormat,
} from './chartInstrumentPresentation';

describe('chart instrument presentation', () => {
  it('keeps the BTC and Gold control universe explicit and canonical', () => {
    expect(CHART_INSTRUMENTS.map((instrument) => instrument.symbol)).toEqual(['BTCUSDT', 'XAUUSD']);
    expect(getChartInstrumentPresentation('BTCUSDT')).toMatchObject({ label: 'BTC', displaySymbol: 'BTCUSDT', pricePrecision: 2 });
    expect(getChartInstrumentPresentation('XAUUSD')).toMatchObject({ label: 'Gold', displaySymbol: 'XAUUSD', pricePrecision: 2 });
  });

  it('formats BTC and Gold prices with isolated presentation precision', () => {
    expect(formatChartInstrumentPrice('BTCUSDT', 118_420.16)).toBe('$118,420.16');
    expect(formatChartInstrumentPrice('XAUUSD', 2_345.678)).toBe('$2,345.68');
    expect(getChartPriceFormat('BTCUSDT')).toEqual({ type: 'price', precision: 2, minMove: 0.1 });
    expect(getChartPriceFormat('XAUUSD')).toEqual({ type: 'price', precision: 2, minMove: 0.01 });
  });

  it('uses a safe generic presentation for an unknown symbol without treating it as BTC', () => {
    expect(getChartInstrumentPresentation('ETHUSDT')).toMatchObject({ label: 'ETHUSDT', displaySymbol: 'ETHUSDT', pricePrecision: 2 });
  });
});