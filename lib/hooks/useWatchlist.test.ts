import { describe, expect, it } from 'vitest';
import { fmtCompact, toWatchlistRow } from './useWatchlist';

describe('fmtCompact', () => {
  it('formats K/M/B always to 2 decimals; small numbers whole; NaN → em dash', () => {
    expect(fmtCompact(942)).toBe('942');
    expect(fmtCompact(9180)).toBe('9.18K');
    expect(fmtCompact(161590)).toBe('161.59K');
    expect(fmtCompact(6_810_000)).toBe('6.81M');
    expect(fmtCompact(2_500_000_000)).toBe('2.50B');
    expect(fmtCompact(NaN)).toBe('—');
  });
});

describe('toWatchlistRow', () => {
  it('maps Binance 24hr ticker strings to numbers', () => {
    const t = { symbol: 'BTCUSDT', lastPrice: '64602.80', priceChange: '618.61', priceChangePercent: '0.97', volume: '9180' };
    expect(toWatchlistRow(t, 'BTCUSDT')).toEqual({
      symbol: 'BTCUSDT', label: 'BTCUSDT', last: 64602.8, chg: 618.61, chgPct: 0.97, vol: 9180,
    });
  });
});
