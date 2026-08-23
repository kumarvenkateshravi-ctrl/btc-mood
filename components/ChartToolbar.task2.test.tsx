// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartToolbar, { type ChartToolbarProps } from './ChartToolbar';

const props: ChartToolbarProps = {
  symbol: 'BTCUSDT', price: 118_420.16, changeAbs: 412.4, change: 0.35, status: 'live', marketIntegrity: 'live',
  selected: '5m', onSelectTf: () => {}, chartType: 'candlestick', onSelectType: () => {},
  showSignals: true, onToggleSignals: () => {}, isFullscreen: false, onToggleFullscreen: () => {}, onFitContent: () => {},
  renko: { method: 'traditional', boxSize: 100, atrLength: 14, percentage: 0.5 }, onRenkoChange: () => {},
  activeIndicatorIds: [], onToggleIndicator: () => {}, onClearIndicators: () => {}, replayActive: false, onReplayToggle: () => {},
  historyActive: false, gridCount: 1, onGridChange: () => {},
  workspaceCurrent: { chartType: 'candlestick', symbol: 'BTCUSDT', tf: '5m', indicatorIds: [] }, onWorkspaceApply: () => {},
};

function toolbar(overrides: Partial<ChartToolbarProps> = {}) {
  return renderToStaticMarkup(<ChartToolbar {...props} {...overrides} />);
}

describe('Stage 7 Task 2 ChartToolbar responsive composition', () => {
  it('renders a dedicated mobile composition with touch-sized primary controls and an all-timeframes affordance', () => {
    const out = toolbar();
    expect(out).toContain('data-testid="mobile-chart-toolbar"');
    expect(out).toContain('data-priority="P1"');
    expect(out).toContain('min-h-11');
    expect(out).toContain('All timeframes');
    expect(out).toContain('More chart controls');
  });

  it('routes touch-sized BTC/Gold and timeframe controls through their existing callbacks', async () => {
    const onSelectSymbol = vi.fn();
    const onSelectTf = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(<ChartToolbar {...props} onSelectSymbol={onSelectSymbol} onSelectTf={onSelectTf} />); });

    const gold = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Gold XAUUSD"]')).find((button) => !button.disabled);
    const oneHour = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === '1h' && !button.disabled);
    await act(async () => {
      gold?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      oneHour?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelectSymbol).toHaveBeenCalledWith('XAUUSD');
    expect(onSelectTf).toHaveBeenCalledWith('1h');
    await act(async () => { root.unmount(); });
  });
  it('keeps a single-row professional desktop toolbar with direct selected timeframe state', () => {
    const out = toolbar({ selected: '4h' });
    expect(out).toContain('data-testid="desktop-chart-toolbar"');
    expect(out).toContain('aria-pressed="true" title="Timeframe 4h"');
    expect(out).toContain('h-[40px]');
  });

  it('offers BTC and Gold in the compact instrument control and formats Gold independently', () => {
    const btc = toolbar();
    const gold = toolbar({ symbol: 'XAUUSD', price: 2345.678, changeAbs: -12.34, change: -0.52 });
    expect(btc).toContain('BTC');
    expect(btc).toContain('Gold');
    expect(gold).toContain('XAUUSD');
    expect(gold).toContain('$2,345.68');
  });

  it('keeps live, replay, paper and stale states explicit in mobile context', () => {
    expect(toolbar({ executionMode: 'live', marketIntegrity: 'live' })).toContain('PAPER');
    expect(toolbar({ executionMode: 'replay', replayActive: true, marketIntegrity: 'replay' })).toContain('REPLAY');
    expect(toolbar({ marketIntegrity: 'stale' })).toContain('Trading paused');
  });
});