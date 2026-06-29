import { describe, expect, it } from 'vitest';
import { buildTradingViewFixtureFromCsv, parseTradingViewCsv } from './tradingViewCsv';

const csv = [
  'time,open,high,low,close,volume,RSI,RSI-based MA,Comment',
  '2026-06-27T09:15:00.000Z,100,105,99,104,10,na,,"quoted, cell"',
  '2026-06-27T09:20:00.000Z,104,106,101,102,12,51.25,50.50,plain',
  '2026-06-27T09:25:00.000Z,102,108,100,107,14,55.75,52.00,plain',
].join('\n');

describe('TradingView CSV fixture builder', () => {
  it('parses quoted TradingView CSV cells', () => {
    const rows = parseTradingViewCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0].Comment).toBe('quoted, cell');
  });

  it('builds a sparse tradingview golden fixture from exported values', () => {
    const fixture = buildTradingViewFixtureFromCsv({
      indicator: 'rsi',
      csv,
      params: { length: 14, source: 'close', maType: 'SMA', maLength: 14 },
      plots: [
        { plotId: 'rsi', column: 'RSI' },
        { plotId: 'rsiMa', column: 'RSI-based MA' },
      ],
      capturedAt: '2026-06-27',
      lastN: 2,
    });

    expect(fixture.source).toBe('tradingview');
    expect(fixture.candles[0]).toEqual({
      time: 1782551700,
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 10,
    });
    expect(fixture.expected.plots.rsi).toEqual({ '1': 51.25, '2': 55.75 });
    expect(fixture.expected.plots.rsiMa).toEqual({ '1': 50.5, '2': 52 });
  });
});
