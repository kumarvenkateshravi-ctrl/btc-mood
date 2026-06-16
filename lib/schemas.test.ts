import { describe, it, expect } from 'vitest';
import {
  BinanceKlinesSchema,
  CandleArraySchema,
  parseCandlesFromBinance,
} from './schemas';

const validKline = [
  1700000000000,
  '100.5',
  '110.2',
  '95.3',
  '105.0',
  '12.5',
  1700000059999,
  '1200.0',
  42,
  '6.0',
  '600.0',
  '0',
];

describe('parseCandlesFromBinance', () => {
  it('parses a single valid row', () => {
    const out = parseCandlesFromBinance([validKline]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      time: 1700000000,
      open: 100.5,
      high: 110.2,
      low: 95.3,
      close: 105.0,
      volume: 12.5,
    });
  });

  it('rejects a row where the open price is not a string', () => {
    expect(() => parseCandlesFromBinance([[1700000000000, 100, 110, 95, 105, 12, 0, '0', 0, '0', '0', '0']])).toThrow();
  });

  it('rejects an empty array', () => {
    expect(() => parseCandlesFromBinance([])).toThrow();
  });

  it('rejects junk payloads', () => {
    expect(() => parseCandlesFromBinance(null)).toThrow();
    expect(() => parseCandlesFromBinance('not an array')).toThrow();
  });
});

describe('CandleArraySchema', () => {
  it('rejects candles with negative volume', () => {
    expect(
      CandleArraySchema.safeParse([
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: -1 },
      ]).success,
    ).toBe(false);
  });

  it('rejects candles with non-integer time', () => {
    expect(
      CandleArraySchema.safeParse([
        { time: 1.5, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ]).success,
    ).toBe(false);
  });
});

describe('BinanceKlinesSchema', () => {
  it('accepts the canonical 12-element shape', () => {
    expect(BinanceKlinesSchema.safeParse([validKline]).success).toBe(true);
  });

  it('rejects a row missing the close-time field', () => {
    const short = validKline.slice(0, 6);
    expect(BinanceKlinesSchema.safeParse([short]).success).toBe(false);
  });
});
