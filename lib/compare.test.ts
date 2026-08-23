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

  it('COMPARE_SYMBOLS lists the focused BTC and Gold instruments', () => {
    const symbols = COMPARE_SYMBOLS.map((c) => c.symbol);
    expect(symbols).toEqual(['BTCUSDT', 'XAUUSD']);
  });

  it('isCompareSymbol returns true only for known symbols', () => {
    expect(isCompareSymbol('BTCUSDT')).toBe(true);
    expect(isCompareSymbol('XAUUSD')).toBe(true);
    expect(isCompareSymbol('ETHUSDT')).toBe(false);
    expect(isCompareSymbol('SOLUSDT')).toBe(false);
    expect(isCompareSymbol('DOGEUSDT')).toBe(false);
    expect(isCompareSymbol('btcusdt')).toBe(false);
    expect(isCompareSymbol('')).toBe(false);
  });
});
