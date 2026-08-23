// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartToolbar, { type ChartToolbarProps } from './ChartToolbar';
import DrawingToolbar from './DrawingToolbar';

const toolbarProps: ChartToolbarProps = {
  symbol: 'BTCUSDT', price: 118_420, change: 0.3, status: 'live', marketIntegrity: 'live',
  selected: '5m', onSelectTf: vi.fn(), chartType: 'candlestick', onSelectType: vi.fn(),
  showSignals: true, onToggleSignals: vi.fn(), isFullscreen: false, onToggleFullscreen: vi.fn(),
  isFocusMode: false, onToggleFocus: vi.fn(), onFitContent: vi.fn(),
  renko: { method: 'traditional', boxSize: 100, atrLength: 14, percentage: 0.5 }, onRenkoChange: vi.fn(),
  activeIndicatorIds: [], onToggleIndicator: vi.fn(), onClearIndicators: vi.fn(), replayActive: false, onReplayToggle: vi.fn(),
  historyActive: false, gridCount: 1, onGridChange: vi.fn(),
  workspaceCurrent: { chartType: 'candlestick', symbol: 'BTCUSDT', tf: '5m', indicatorIds: [] }, onWorkspaceApply: vi.fn(),
  onOpenDrawings: vi.fn(),
};

const drawingProps = {
  tool: 'cursor' as const,
  onToolChange: vi.fn(),
  color: '#5aa2e6',
  onColorChange: vi.fn(),
  magnet: false,
  onMagnetToggle: vi.fn(),
  locked: false,
  onLockToggle: vi.fn(),
  hidden: false,
  onHiddenToggle: vi.fn(),
  onClear: vi.fn(),
  count: 2,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: true,
  canRedo: false,
  selected: false,
  onDeleteSelected: vi.fn(),
  mobileOpen: false,
  onMobileClose: vi.fn(),
  scopeLabel: 'BTCUSDT',
};

describe('Stage 7 Task 7 interaction polish', () => {
  it('exposes one Focus Chart action and a touch-first Draw entry point', () => {
    const html = renderToStaticMarkup(<ChartToolbar {...toolbarProps} />);
    expect(html).toContain('Focus chart');
    expect(html).toContain('Open drawing tools');
    expect(html).toContain('aria-pressed="false"');
  });

  it('marks Focus Chart active without changing chart ownership', () => {
    const onToggleFocus = vi.fn();
    const html = renderToStaticMarkup(<ChartToolbar {...toolbarProps} isFocusMode onToggleFocus={onToggleFocus} />);
    expect(html).toContain('Exit Focus');
    expect(html).toContain('aria-pressed="true"');
  });

  it('surfaces drawing history controls and a destructive clear affordance', () => {
    const html = renderToStaticMarkup(<DrawingToolbar {...drawingProps} />);
    expect(html).toContain('Undo drawing');
    expect(html).toContain('Redo drawing');
    expect(html).toContain('Clear drawings for BTCUSDT');
    expect(html).toContain('Delete selected drawing');
  });

  it('requires explicit confirmation before clearing drawings', async () => {
    const onClear = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(<DrawingToolbar {...drawingProps} onClear={onClear} />); });
    const clear = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label')?.startsWith('Clear drawings'));
    await act(async () => { clear?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Clear all drawings for BTCUSDT?');
    expect(onClear).not.toHaveBeenCalled();
    const confirm = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Clear Drawings'));
    await act(async () => { confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClear).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
