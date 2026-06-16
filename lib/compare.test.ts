import { describe, it, expect } from 'vitest';
import {
  COMPARE_SYMBOLS,
  DEFAULT_COMPARE_SYMBOL,
  isCompareSymbol,
} from './compare';

describe('compare', () => {
  it('DEFAULT_COMPARE_SYMBOL is BTCUSDT', () => {
    expect(DEFAULT_COMPARE_SYMBOL).toBe('BTCUSDT');
  });

  it('COMPARE_SYMBOLS lists BTC, ETH, SOL against USDT', () => {
    const symbols = COMPARE_SYMBOLS.map((c) => c.symbol);
    expect(symbols).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('isCompareSymbol returns true only for the known symbols', () => {
    expect(isCompareSymbol('BTCUSDT')).toBe(true);
    expect(isCompareSymbol('ETHUSDT')).toBe(true);
    expect(isCompareSymbol('SOLUSDT')).toBe(true);
    expect(isCompareSymbol('DOGEUSDT')).toBe(false);
    expect(isCompareSymbol('btcusdt')).toBe(false);
    expect(isCompareSymbol('')).toBe(false);
  });
});
