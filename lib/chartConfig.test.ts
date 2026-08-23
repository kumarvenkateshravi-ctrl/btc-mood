import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPARE_SYMBOL } from './compare';
import { resolveChartConfig, parsePersistedChartConfig, type ChartConfigSources } from './chartConfig';

const defaults = {
  symbol: DEFAULT_COMPARE_SYMBOL,
  timeframe: '15m' as const,
  chartType: 'candlestick' as const,
  indicatorIds: ['ema::default'],
  rightPanel: 'signals' as const,
};

const valid = (sources: ChartConfigSources = {}) => resolveChartConfig({
  defaults,
  validIndicator: (id) => id === 'ema::default' || id === 'rsi::default',
  ...sources,
});

describe('chart configuration ownership and precedence', () => {
  it('resolves URL/session values over workspace, persisted values, and defaults', () => {
    expect(valid({
      persisted: { symbol: 'XAUUSD', timeframe: '1h', chartType: 'renko', rightPanel: 'mood' },
      workspace: { symbol: 'BTCUSDT', timeframe: '4h', chartType: 'heikinAshi', rightPanel: 'orderflow' },
      url: { symbol: 'BTCUSDT', timeframe: '5m' },
    })).toEqual({
      symbol: 'BTCUSDT', timeframe: '5m', chartType: 'heikinAshi', indicatorIds: ['ema::default'], rightPanel: 'orderflow',
    });
  });

  it('uses persisted values when higher-priority sources omit a field', () => {
    expect(valid({ persisted: { timeframe: '1h', chartType: 'renko' }, workspace: { symbol: 'BTCUSDT' } })).toMatchObject({
      symbol: 'BTCUSDT', timeframe: '1h', chartType: 'renko',
    });
  });

  it('falls back to defaults for malformed values', () => {
    expect(valid({
      url: { symbol: 'not-a-symbol', timeframe: '2h', chartType: 'unknown', indicatorIds: ['bad'] },
      persisted: { symbol: 'also-bad', timeframe: 'bad' },
    })).toEqual(defaults);
  });

  it('filters invalid indicator IDs without allowing storage to poison the stack', () => {
    expect(valid({ persisted: { indicatorIds: ['bad', 'rsi::default', 42 as unknown as string] } })).toMatchObject({
      indicatorIds: ['rsi::default'],
    });
  });

  it('treats explicit workspace application as a deterministic source', () => {
    const workspace = { symbol: 'BTCUSDT', timeframe: '4h', chartType: 'heikinAshi', indicatorIds: ['rsi::default'] };
    expect(valid({ workspace })).toMatchObject(workspace);
  });

  it('does not carry replay/session-transient fields through persisted payloads', () => {
    const parsed = parsePersistedChartConfig(JSON.stringify({
      version: 1,
      state: { symbol: 'BTCUSDT', replayCut: 123, replaySessionId: 'replay-1', timeframe: '5m' },
    }), (id) => id === 'ema::default');
    expect(parsed).toEqual({ symbol: 'BTCUSDT', timeframe: '5m' });
  });

  it('rejects malformed or unsupported versioned payloads safely', () => {
    expect(parsePersistedChartConfig('{not-json', () => true)).toEqual({});
    expect(parsePersistedChartConfig(JSON.stringify({ version: 99, state: { symbol: 'ETHUSDT' } }), () => true)).toEqual({});
    expect(parsePersistedChartConfig(JSON.stringify({ version: 1, state: { symbol: 'not-valid' } }), () => true)).toEqual({});
  });
});

