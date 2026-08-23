import { describe, expect, it } from 'vitest';
import type { Candle } from './types';
import type { IndicatorEvaluationContext } from './indicatorEvaluation';
import type { TradePresentation } from './trade/presentation';
import type { ChartTradingCommands } from './chartTradingCommands';
import { DEFAULT_CHART_SETTINGS } from '../components/chart/useChartSettings';
import { deriveChartSession, type ChartSessionInput, type ChartSessionSource } from './chartSession';

const bar = (time: number, close: number): Candle => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10,
});

const context = (overrides: Partial<IndicatorEvaluationContext> = {}): IndicatorEvaluationContext => ({
  rawCandles: [bar(100, 10), bar(200, 11)],
  displayCandles: [bar(100, 10), bar(200, 11)],
  closedCandles: [bar(100, 10)],
  hasFormingBar: true,
  symbol: 'BTCUSDT',
  timeframe: '5m',
  mode: 'live',
  transform: 'candlestick',
  sourceRevision: 'rev-1',
  provenance: { raw: 'market', display: 'raw' },
  ...overrides,
});

const presentation = (mode: 'live' | 'replay'): TradePresentation => ({
  mode,
  symbol: 'BTCUSDT',
  position: null,
  trades: [],
  balance: mode === 'live' ? 1_000 : 500,
  initialBalance: mode === 'live' ? 1_000 : 500,
});

const commands = {} as ChartTradingCommands;

const source = (overrides: Partial<ChartSessionSource> = {}): ChartSessionSource => ({
  rawCandles: [bar(100, 10), bar(200, 11)],
  displayCandles: [bar(100, 10), bar(200, 11)],
  visibleCandles: [bar(200, 11)],
  markPrice: 11,
  marketDataIntegrity: 'live',
  indicatorContext: context(),
  ...overrides,
});

function session(overrides: Partial<ChartSessionInput> = {}) {
  return deriveChartSession({
    symbol: 'BTCUSDT',
    visualTimeframe: '5m',
    transform: 'candlestick',
    mode: 'live',
    source: source(),
    tradePresentation: presentation('live'),
    tradingCommands: commands,
    drawingScopeIdentity: 'symbol:BTCUSDT',
    chartSettings: DEFAULT_CHART_SETTINGS,
    ...overrides,
  });
}

describe('canonical chart session model', () => {
  it('derives live chart identity, data, presentation, and trusted mark', () => {
    const result = session();

    expect(result.chart).toMatchObject({ symbol: 'BTCUSDT', visualTimeframe: '5m', transform: 'candlestick' });
    expect(result.execution).toMatchObject({ mode: 'live', replay: null });
    expect(result.data.rawCandles).toHaveLength(2);
    expect(result.data.visibleCandles).toEqual([bar(200, 11)]);
    expect(result.data.trustedMarkPrice).toBe(11);
    expect(result.trading.tradePresentation.mode).toBe('live');
    expect(result.trading.commands).toBe(commands);
  });

  it('derives replay identity, frozen execution timeframe, cut, and snapshot-backed data', () => {
    const snapshot = [bar(100, 10), bar(200, 11)];
    const result = session({
      mode: 'replay',
      source: source({
        rawCandles: snapshot,
        displayCandles: snapshot,
        visibleCandles: snapshot,
        marketDataIntegrity: 'replay',
        indicatorContext: context({
          rawCandles: snapshot,
          displayCandles: snapshot,
          closedCandles: [snapshot[0]],
          mode: 'replay',
          replay: { sessionId: 'replay-1', cutTime: 300, executionTimeframe: '15m' },
          provenance: { raw: 'replay-snapshot', display: 'raw' },
        }),
      }),
      replay: { sessionId: 'replay-1', cutTime: 300, executionTimeframe: '15m' },
      tradePresentation: presentation('replay'),
    });

    expect(result.execution).toMatchObject({
      mode: 'replay',
      replay: { sessionId: 'replay-1', cutTime: 300, executionTimeframe: '15m' },
    });
    expect(result.data.rawCandles).toBe(snapshot);
    expect(result.data.rawCandles).not.toContainEqual(bar(400, 14));
    expect(result.data.trustedMarkPrice).toBe(11);
    expect(result.indicators.context.provenance.raw).toBe('replay-snapshot');
  });

  it('changes identity across live/replay, symbol, timeframe, and transform transitions', () => {
    const live = session();
    const replay = session({
      mode: 'replay',
      replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' },
      source: source({
        marketDataIntegrity: 'replay',
        indicatorContext: context({ mode: 'replay', replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' }, provenance: { raw: 'replay-snapshot', display: 'raw' } }),
      }),
      tradePresentation: presentation('replay'),
    });
    const symbol = session({ symbol: 'ETHUSDT', drawingScopeIdentity: 'symbol:ETHUSDT' });
    const timeframe = session({ visualTimeframe: '1h' });
    const transform = session({ transform: 'renko', source: source({ displayCandles: [bar(200, 12)], indicatorContext: context({ transform: 'renko', provenance: { raw: 'market', display: 'renko' } }) }) });

    expect(new Set([live.identity, replay.identity, symbol.identity, timeframe.identity, transform.identity]).size).toBe(5);
    expect(live.rawSourceIdentity).toBe(transform.rawSourceIdentity);
  });

  it('clears a presentation supplied from the wrong mode or symbol', () => {
    const result = session({
      mode: 'replay',
      replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' },
      source: source({ marketDataIntegrity: 'replay', indicatorContext: context({ mode: 'replay', replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' }, provenance: { raw: 'replay-snapshot', display: 'raw' } }) }),
      tradePresentation: presentation('live'),
    });
    expect(result.trading.tradePresentation.position).toBeNull();
    expect(result.trading.tradePresentation.trades).toEqual([]);
    expect(result.trading.tradePresentation.balance).toBe(0);
  });
  it('does not trust an untrusted live mark, while replay uses its causal snapshot mark', () => {
    const stale = session({ source: source({ marketDataIntegrity: 'stale', markPrice: 11 }) });
    expect(stale.data.trustedMarkPrice).toBeNull();

    const replay = session({
      mode: 'replay',
      replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' },
      source: source({ marketDataIntegrity: 'replay', markPrice: 11, indicatorContext: context({ mode: 'replay', replay: { sessionId: 'r', cutTime: 200, executionTimeframe: '5m' }, provenance: { raw: 'replay-snapshot', display: 'raw' } }) }),
      tradePresentation: presentation('replay'),
    });
    expect(replay.data.trustedMarkPrice).toBe(11);
  });

  it('keeps session derivation stable when unrelated source state is unchanged', () => {
    const first = session();
    const second = session({ source: source({ marketDataIntegrity: 'live' }) });
    expect(second.identity).toBe(first.identity);
    expect(second.rawSourceIdentity).toBe(first.rawSourceIdentity);
  });

  it('exposes read-only chart settings and drawing scope identities', () => {
    const settings = { ...DEFAULT_CHART_SETTINGS, scaleMode: 'log' as const };
    const result = session({ chartSettings: settings, drawingScopeIdentity: 'symbol:BTCUSDT' });
    expect(result.settings.chartSettings).toEqual(settings);
    expect(result.settings.drawingScopeIdentity).toBe('symbol:BTCUSDT');
    expect(result.settings.chartSettingsIdentity).toContain('log');
  });
});
