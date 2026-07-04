'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  side: 'buy' | 'sell';
  symbol: string;
  qty: number;
  entryPrice: number;
  mode: 'normal' | 'edit';
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onReverse: () => void;
  onClose: () => void;
  rr: { risk: number; reward: number; ratio: number | null } | null;
}

const CHIP =
  'h-6 rounded border border-line bg-surface-1/95 px-2 text-[11px] leading-none text-ink hover:bg-surface-2';
const PRIMARY =
  'h-6 rounded bg-accent px-2.5 text-[11px] font-semibold leading-none text-white hover:opacity-90';

/** TV-style active-trade control row, docked to the entry line's y. */
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

  const isEdit = p.mode === 'edit';

  return (
    <div
      className="pointer-events-auto absolute right-[150px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      {isEdit ? (
        <>
          <button type="button" className={PRIMARY} onClick={p.onSave}>
            Save TP/SL
          </button>
          <button type="button" className={CHIP} onClick={p.onCancel}>
            Cancel
          </button>
          {p.rr != null && (
            <span className="ml-1 whitespace-nowrap font-mono text-[11px] text-ink-faint">
              R ${p.rr.risk.toFixed(2)} · Rw ${p.rr.reward.toFixed(2)} · R:R{' '}
              {p.rr.ratio == null ? '—' : p.rr.ratio.toFixed(2)}
            </span>
          )}
        </>
      ) : (
        <>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ${
              p.side === 'buy' ? 'bg-accent' : 'bg-bear-bright'
            }`}
          >
            {p.side === 'buy' ? 'BUY' : 'SELL'}
          </span>
          <span className="text-[11px] text-ink-muted">{p.symbol}</span>
          <span className="text-[11px] text-ink-muted">Qty {p.qty}</span>
          <button type="button" className={CHIP} onClick={p.onEdit}>
            Edit
          </button>
          <button type="button" className={CHIP} onClick={p.onReverse}>
            Reverse
          </button>
          <button
            type="button"
            className={`${CHIP} hover:border-bear-bright/60 hover:bg-bear-bright/10 hover:text-bear-bright`}
            onClick={p.onClose}
          >
            Close
          </button>
        </>
      )}
    </div>
  );
}
