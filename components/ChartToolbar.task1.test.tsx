// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartToolbar, { type ChartToolbarProps } from './ChartToolbar';
import { DEFAULT_CHART_SETTINGS } from './chart/useChartSettings';
import { ChartOHLCStrip } from './chart/ChartOHLCStrip';
import { setHover } from '@/lib/chartHoverStore';

const noop = () => {};

function toolbar(overrides: Partial<ChartToolbarProps> = {}) {
  const props: ChartToolbarProps = {
    symbol: 'BTCUSDT',
    price: 118_420,
    change: 1.24,
    changeAbs: 1_450,
    status: 'live',
    marketIntegrity: 'live',
    connectionStatus: 'open',
    executionMode: 'live',
    positionSide: null,
    selected: '5m',
    onSelectTf: noop,
    chartType: 'candlestick',
    onSelectType: noop,
    showSignals: false,
    onToggleSignals: noop,
    isFullscreen: false,
    onToggleFullscreen: noop,
    onFitContent: noop,
    renko: { method: 'traditional', boxSize: 100, atrLength: 14, percentage: 1 },
    onRenkoChange: noop,
    activeIndicatorIds: [],
    onToggleIndicator: noop,
    onClearIndicators: noop,
    replayActive: false,
    onReplayToggle: noop,
    historyActive: false,
    gridCount: 1,
    onGridChange: noop,
    workspaceCurrent: { chartType: 'candlestick', symbol: 'BTCUSDT', tf: '5m', indicatorIds: [] },
    onWorkspaceApply: noop,
    chartSettings: DEFAULT_CHART_SETTINGS,
    onChartSettingsPatch: noop,
    onChartSettingsReset: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<ChartToolbar {...props} />);
}

afterEach(() => setHover(null));

describe('Stage 7 Task 1 — chart status line', () => {
  it('keeps historical OHLCV context available through the existing hover store', () => {
    setHover({
      src: { time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12_500 },
      base: { time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12_500 },
      prevBase: { time: 1_699_999_700, open: 98, high: 101, low: 96, close: 100, volume: 10_000 },
    });

    const out = renderToStaticMarkup(<ChartOHLCStrip mode="candlestick" />);
    expect(out).toContain('aria-label="Chart OHLCV"');
    for (const label of ['O', 'H', 'L', 'C', 'Vol']) expect(out).toContain(`>${label}<`);
    expect(out).toContain('105.00');
    expect(out).toContain('12.50K');
  });
});

describe('Stage 7 Task 1 — chart context toolbar', () => {
  it('presents BTC, current price, UTC-session absolute/percent change, and chart type once', () => {
    const out = toolbar();

    expect(out).toContain('data-testid="chart-context"');
    expect(out).toContain('BTCUSDT');
    expect(out).toContain('$118,420.00');
    expect(out).toContain('+1,450.00');
    expect(out).toContain('+1.24%');
    expect(out).toContain('Candles');
    expect((out.match(/data-testid="chart-context"/g) ?? [])).toHaveLength(1);
  });

  it('keeps every supported timeframe immediately reachable and marks the selected timeframe', () => {
    const out = toolbar({ selected: '1h' });

    for (const timeframe of ['5m', '15m', '30m', '1h', '4h', '1d']) {
      expect(out).toContain(`>${timeframe}<`);
    }
    expect(out).toMatch(/aria-pressed="true"[^>]*>1h</);
  });

  it('renders a quiet LIVE + PAPER identity for trusted live paper trading', () => {
    const out = toolbar();

    expect(out).toContain('LIVE');
    expect(out).toContain('PAPER');
    expect(out).toContain('Market data live and synchronized');
  });

  it('makes stale market data prominent and explains that trading is paused', () => {
    const out = toolbar({ marketIntegrity: 'stale', connectionStatus: 'closed' });

    expect(out).toContain('STALE');
    expect(out).toContain('Trading paused');
    expect(out).toContain('Market data is stale. Price-dependent trading is paused.');
  });

  it('keeps replay identity separate from live paper identity', () => {
    const out = toolbar({ executionMode: 'replay', replayActive: true, marketIntegrity: 'replay' });

    expect(out).toContain('REPLAY');
    expect(out).toContain('PAPER');
    expect(out).not.toContain('Market data live and synchronized');
  });

  it.each([
    ['long', 'LONG'],
    ['short', 'SHORT'],
  ] as const)('shows an active %s position without duplicating position metrics', (side, label) => {
    const out = toolbar({ positionSide: side });

    expect(out).toContain(label);
    expect(out).toContain(`Active ${label.toLowerCase()} position`);
    expect(out).not.toContain('R:R');
    expect(out).not.toContain('Capital used');
  });

  it('does not present a wrong-symbol position as active', () => {
    const out = toolbar({ symbol: 'BTCUSDT', positionSide: null });

    expect(out).not.toContain('Active long position');
    expect(out).not.toContain('Active short position');
  });
});
