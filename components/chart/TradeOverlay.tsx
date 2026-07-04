'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
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
  const TP_COLOR = '#22d39a';   // green
  const SL_COLOR = '#f5a623';   // amber

  return (
    <div
      className="pointer-events-auto absolute right-[260px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      <button type="button" className={chip} style={{ borderColor: '#2A62FF' }} title="Reverse position" onClick={p.onReverse}>
        ⇅
      </button>

      {p.isDirty && (
        <>
          <button type="button" className={chip} onClick={p.onDiscard}>Discard</button>
          <button type="button" className={primary} onClick={p.onConfirm}>Confirm</button>
        </>
      )}

      <button
        type="button"
        className={`${chip} ${p.hasTp ? '' : 'border-dotted'}`}
        style={{ color: TP_COLOR, borderColor: TP_COLOR }}
        onClick={p.onToggleTp}
        title={p.hasTp ? 'Remove take-profit' : 'Add take-profit'}
      >
        TP
      </button>
      <button
        type="button"
        className={`${chip} ${p.hasSl ? '' : 'border-dotted'}`}
        style={{ color: SL_COLOR, borderColor: SL_COLOR }}
        onClick={p.onToggleSl}
        title={p.hasSl ? 'Remove stop-loss' : 'Add stop-loss'}
      >
        SL
      </button>
    </div>
  );
}
