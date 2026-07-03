'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface OrderControlsRowProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  entryPrice: number;
  hasTp: boolean;
  hasSl: boolean;
  onReverse: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onToggleTp: () => void;
  onToggleSl: () => void;
}

/** TV-style staged-order controls, docked to the entry line's y. */
export function OrderControlsRow(p: OrderControlsRowProps) {
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
  return (
    <div
      className="pointer-events-auto absolute right-[150px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      <button type="button" className={chip} title="Reverse side" onClick={p.onReverse}>⇅</button>
      <button type="button" className={chip} onClick={p.onDiscard}>Discard</button>
      <button
        type="button"
        className="h-6 rounded bg-accent px-2.5 text-[11px] font-semibold leading-none text-white hover:opacity-90"
        onClick={p.onConfirm}
      >
        Confirm
      </button>
      <button type="button" className={`${chip} ${p.hasTp ? 'text-bull-bright' : 'border-dashed text-ink-faint'}`} onClick={p.onToggleTp}>TP</button>
      <button type="button" className={`${chip} ${p.hasSl ? 'text-bear-bright' : 'border-dashed text-ink-faint'}`} onClick={p.onToggleSl}>SL</button>
    </div>
  );
}
