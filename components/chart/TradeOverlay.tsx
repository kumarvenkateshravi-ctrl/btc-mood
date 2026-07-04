'use client';

import { useEffect, useReducer } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  entryPrice: number;
  qty: number;
  /** Live unrealized P&L for the open position (drives the pill colour). */
  pnl: number;
  /** A staged, unconfirmed TP/SL change is pending → show Discard / Confirm. */
  isDirty: boolean;
  hasTp: boolean;
  hasSl: boolean;
  onReverse: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onToggleTp: () => void;
  onToggleSl: () => void;
  onClose: () => void;
}

const ENTRY_BLUE = '#2A62FF';
const TP_COLOR = '#22d39a'; // green
const SL_COLOR = '#f5a623'; // amber

/**
 * TradingView-style trade control row docked to the entry line's y-coordinate.
 * A single DOM cluster: `⇅` reverse · (Discard/Confirm when a TP/SL edit is
 * pending) · `TP`/`SL` toggle chips · then the `[qty | ±P&L | ✕]` pill. Keeping
 * the pill in this row (rather than on the canvas) makes the whole thing one
 * self-spacing unit, with a clean gap to the price axis. TP/SL lines are dragged
 * directly on the chart; Close is the pill's `✕`.
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

  const pnlStr = `${p.pnl >= 0 ? '+' : '−'}${Math.abs(p.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

  return (
    <div
      className="pointer-events-auto absolute right-[120px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      <button type="button" className={chip} style={{ borderColor: ENTRY_BLUE }} title="Reverse position" onClick={p.onReverse}>
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

      {/* qty | ±P&L | ✕ pill — gapped from the chips, floats left of the axis */}
      <div className="ml-3 flex h-6 items-center overflow-hidden rounded border" style={{ borderColor: ENTRY_BLUE }}>
        <span className="flex h-full items-center px-2 text-[11px] font-medium leading-none text-white" style={{ background: ENTRY_BLUE }}>
          {p.qty}
        </span>
        <span
          className="flex h-full items-center bg-surface-1/95 px-2 font-mono text-[11px] leading-none"
          style={{ color: p.pnl >= 0 ? TP_COLOR : '#fb5168' }}
        >
          {pnlStr}
        </span>
        <button
          type="button"
          onClick={p.onClose}
          title="Close trade"
          className="flex h-full items-center border-l border-line bg-surface-1/95 px-1.5 text-[11px] leading-none text-ink-faint hover:text-bear-bright"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
