/**
 * Test harness for Chart smoke tests.
 *
 * Wraps <Chart> with callback props that record invocations into React state
 * and expose them via DOM data attributes — readable via page.locator(),
 * avoiding window/iframe context ambiguity in Playwright CT.
 */
import { useRef, useState, useCallback } from 'react';
import Chart from '../Chart';
import type { ChartApi, ChartType } from '../Chart';
import type { Candle } from '../../lib/types';
import type { IndicatorRender } from './types';

interface HarnessProps {
  candles: Candle[];
  type?: ChartType;
  tf?: string;
  height?: number;
  activeIndicatorId?: string;
  activeIndicatorIds?: string[];
  indicatorResults?: IndicatorRender[];
}

export function ChartHarness({
  candles,
  type = 'candlestick',
  tf = '5m',
  height = 600,
  activeIndicatorId = '',
  activeIndicatorIds,
  indicatorResults,
}: HarnessProps) {
  const [quickTradeCalls, setQuickTradeCalls] = useState<string[]>([]);
  const [loadOlderCalls, setLoadOlderCalls] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<{ price: number; x: number; y: number } | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [rangeInfo, setRangeInfo] = useState<string>('');
  const apiRef = useRef<ChartApi | null>(null);

  const onQuickTrade = useCallback((side: 'buy' | 'sell') => {
    setQuickTradeCalls((prev) => [...prev, side]);
  }, []);

  const onLoadOlder = useCallback(() => {
    setLoadOlderCalls((c) => c + 1);
  }, []);

  const onChartContextMenu = useCallback((price: number, x: number, y: number) => {
    setCtxMenu({ price, x, y });
  }, []);

  const onReady = useCallback((api: ChartApi) => {
    apiRef.current = api;
    setApiReady(true);
  }, []);

  // Button to snapshot the current visible logical range (for theme-zoom test).
  const snapshotRange = useCallback(() => {
    const r = apiRef.current?.getVisibleLogicalRange();
    setRangeInfo(r ? `${r.from.toFixed(2)},${r.to.toFixed(2)}` : 'null');
  }, []);

  return (
    <div style={{ width: '1000px', height: '600px' }}>
      <Chart
        candles={candles}
        type={type}
        tf={tf}
        height={height}
        activeIndicatorId={activeIndicatorId}
        onIndicatorChange={() => {}}
        activeIndicatorIds={activeIndicatorIds}
        indicatorResults={indicatorResults}
        onQuickTrade={onQuickTrade}
        onLoadOlder={onLoadOlder}
        onChartContextMenu={onChartContextMenu}
        onReady={onReady}
      />
      {/* Hidden DOM nodes exposing test state — readable via page.locator(). */}
      <div data-testid="test-state" style={{ display: 'none' }}
        data-quick-trade={quickTradeCalls.join(',')}
        data-load-older={String(loadOlderCalls)}
        data-api-ready={String(apiReady)}
        data-ctx-price={ctxMenu ? String(ctxMenu.price) : ''}
        data-ctx-x={ctxMenu ? String(ctxMenu.x) : ''}
        data-ctx-y={ctxMenu ? String(ctxMenu.y) : ''}
        data-range={rangeInfo}
      />
      {/* Off-screen button to trigger a range snapshot (used by theme test). */}
      <button data-testid="snapshot-range" onClick={snapshotRange}
        style={{ position: 'absolute', left: '-9999px' }}
      >
        Snapshot
      </button>
    </div>
  );
}
