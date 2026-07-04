'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  symbol: string;
  entryPrice: number;
  /** A staged, unconfirmed TP/SL change is pending → show Discard / Confirm. */
  isDirty: boolean;
  hasTp: boolean;
  hasSl: boolean;
  onReverse: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onToggleTp: () => void;
  onToggleSl: () => void;
}

/**
 * TradingView-style trade control row docked to the entry line's y-coordinate.
 * TP/SL lines are dragged directly on the chart; this row is the compact
 * controller: `⇅` reverses the position, the `TP`/`SL` chips add/remove exits,
 * and once anything changes (drag or toggle) `Discard` / `Confirm` appear to
 * revert or commit. Close lives on the entry line's `✕` pill (drawn on canvas).
 */
export function TradeOverlay(p: TradeOverlayProps) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!p.chart) return;
    const ts = p.chart.timeScale();
    const onRange = () => bump();
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return () => ts.unsubscribeVisibleLogicalRangeChange(onRange);
  }, [p.chart]);

  const y = p.series?.priceToCoordinate(p.entryPrice) ?? null;
  if (y == null) return null;

  const chip = 'h-6 rounded border border-line bg-surface-1/95 px-2 text-[11px] leading-none text-ink hover:bg-surface-2';
  const primary = 'h-6 rounded bg-accent px-2.5 text-[11px] font-semibold leading-none text-white hover:opacity-90';

  return (
    <div
      className="pointer-events-auto absolute right-[150px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      <button type="button" className={chip} title="Reverse position" onClick={p.onReverse}>⇅</button>

      {p.isDirty && (
        <>
          <button type="button" className={chip} onClick={p.onDiscard}>Discard</button>
          <button type="button" className={primary} onClick={p.onConfirm}>Confirm</button>
        </>
      )}

      <button
        type="button"
        className={`${chip} ${p.hasTp ? 'text-bull-bright' : 'border-dashed text-ink-faint'}`}
        onClick={p.onToggleTp}
        title={p.hasTp ? 'Remove take-profit' : 'Add take-profit'}
      >
        TP
      </button>
      <button
        type="button"
        className={`${chip} ${p.hasSl ? 'text-bear-bright' : 'border-dashed text-ink-faint'}`}
        onClick={p.onToggleSl}
        title={p.hasSl ? 'Remove stop-loss' : 'Add stop-loss'}
      >
        SL
      </button>

      <span className="ml-0.5 font-mono text-[10px] text-ink-faint">{p.symbol}</span>
    </div>
  );
}
