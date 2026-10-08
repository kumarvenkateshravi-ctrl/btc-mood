// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ChartToolbar, { type ChartToolbarProps } from './ChartToolbar';
import DrawingToolbar from './DrawingToolbar';
import ReplayBar from './ReplayBar';

const toolbar: ChartToolbarProps = {
  symbol:'BTCUSDT', price:85000, changeAbs:100, change:.12, status:'live', marketIntegrity:'live', selected:'5m',
  onSelectTf:vi.fn(), onSelectSymbol:vi.fn(), chartType:'candlestick', onSelectType:vi.fn(), showSignals:true, onToggleSignals:vi.fn(),
  isFullscreen:false, onToggleFullscreen:vi.fn(), onFitContent:vi.fn(), renko:{ method:'traditional', boxSize:100, atrLength:14, percentage:.5 }, onRenkoChange:vi.fn(),
  activeIndicatorIds:[], onToggleIndicator:vi.fn(), onClearIndicators:vi.fn(), replayActive:false, onReplayToggle:vi.fn(), historyActive:false, gridCount:1, onGridChange:vi.fn(), onOpenDrawings:vi.fn(),
};

describe('mobile toolbar workflows', () => {
  it.each(['loading', 'unavailable'] as const)('hides a previous instrument tick when the new instrument is %s', async (marketIntegrity) => {
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<ChartToolbar {...toolbar} />));
    expect(host.textContent).toContain('$85,000.00');
    await act(async () => root.render(<ChartToolbar {...toolbar} symbol="XAUUSD" marketIntegrity={marketIntegrity} />));
    expect(host.textContent).not.toContain('$85,000.00');
    expect(host.querySelector('[data-testid="mobile-chart-toolbar"]')?.textContent).toContain('Price unavailable');
    await act(async () => root.unmount());
  });
  it('routes instrument and secondary timeframe selections through mobile sheets', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<ChartToolbar {...toolbar} />));
    const mobile = host.querySelector('[data-testid="mobile-chart-toolbar"]')!;
    const click = async (selector:string) => { const el = mobile.querySelector<HTMLButtonElement>(selector); expect(el).toBeTruthy(); await act(async () => el!.click()); };
    await click('[aria-label="Select instrument, current BTCUSDT"]');
    await click('[aria-label="Gold XAUUSD"]'); expect(toolbar.onSelectSymbol).toHaveBeenCalledWith('XAUUSD');
    expect(mobile.querySelector('dialog')).toBeNull();
    await click('[aria-label="All timeframes, current 5m"]');
    const oneDay = Array.from(mobile.querySelectorAll('dialog button')).find(b => b.textContent === '1d') as HTMLButtonElement;
    await act(async () => oneDay.click()); expect(toolbar.onSelectTf).toHaveBeenCalledWith('1d');
    expect(mobile.querySelector('dialog')).toBeNull();
    await click('[aria-label="Open drawing tools"]'); expect(toolbar.onOpenDrawings).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); host.remove();
  });
  it('selects a drawing tool, closes the sheet, and leaves persistence to its owner', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onToolChange=vi.fn(), onMobileClose=vi.fn(), onClear=vi.fn();
    await act(async () => root.render(<DrawingToolbar tool="cursor" color="#fff" onColorChange={vi.fn()} onToolChange={onToolChange} magnet={false} onMagnetToggle={vi.fn()} locked={false} onLockToggle={vi.fn()} hidden={false} onHiddenToggle={vi.fn()} onClear={onClear} count={1} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} mobileOpen onMobileClose={onMobileClose} scopeLabel="BTCUSDT" />));
    const button = Array.from(host.querySelectorAll('dialog button')).find(b => b.textContent === 'Trend') as HTMLButtonElement;
    await act(async () => button.click()); expect(onToolChange).toHaveBeenCalledExactlyOnceWith('trendline'); expect(onMobileClose).toHaveBeenCalledOnce(); expect(onClear).not.toHaveBeenCalled();
    await act(async () => root.unmount()); host.remove();
  });
  it('routes previous and next replay controls and blocks them while selecting', async () => {
    const host=document.createElement('div'); const root=createRoot(host); const onStep=vi.fn();
    const props={ selecting:false, playing:false, speed:1, onExit:vi.fn(), onTogglePlay:vi.fn(), onSpeed:vi.fn(), onStep };
    await act(async () => root.render(<ReplayBar {...props} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Previous replay candle"]')!.click(); host.querySelector<HTMLButtonElement>('[aria-label="Next replay candle"]')!.click(); });
    expect(onStep.mock.calls).toEqual([[-1],[1]]);
    await act(async () => root.render(<ReplayBar {...props} selecting />));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next replay candle"]')!.disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
