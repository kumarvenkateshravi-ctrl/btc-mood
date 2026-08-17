import { describe, it, expect } from 'vitest';
import { candlesToCsv, tradesToCsv } from './csv';
import type { Candle } from './types';
import type { PaperTrade } from './paper';

const sample: Candle[] = [
  { time: 1700000000, open: 100, high: 110, low: 95, close: 105, volume: 12.5 },
  { time: 1700000060, open: 105, high: 108, low: 100, close: 101, volume: 7.2 },
];

describe('candlesToCsv', () => {
  it('starts with the canonical header', () => {
    const out = candlesToCsv(sample);
    expect(out.split('\n')[0]).toBe('time,open,high,low,close,volume');
  });

  it('emits one row per candle with ISO time + numeric OHLCV', () => {
    const lines = candlesToCsv(sample).split('\n');
    expect(lines).toHaveLength(3);
    // First data row: 2023-11-14T22:13:20.000Z, 100, 110, 95, 105, 12.5
    expect(lines[1]).toMatch(
      /^2023-11-14T22:13:20\.000Z,100,110,95,105,12\.5$/,
    );
  });

  it('returns just the header for an empty input', () => {
    expect(candlesToCsv([])).toBe('time,open,high,low,close,volume');
  });

  it('handles an empty array without trailing newline', () => {
    const out = candlesToCsv([]);
    expect(out.endsWith('\n')).toBe(false);
  });
});

describe('tradesToCsv', () => {
  it('includes the originating symbol in each exported row', () => {
    const trade: PaperTrade = {
      id: 't1', positionId: 'p1', symbol: 'BTCUSDT', side: 'sell', units: 1,
      price: 110, fee: 0, realizedPnl: 10, ts: 2_000, entryPrice: 100, entryTs: 1_000,
    };
    const [header, row] = tradesToCsv([trade]).split('\n');
    expect(header).toContain('Symbol');
    expect(row).toContain(',BTCUSDT,');
  });
});
