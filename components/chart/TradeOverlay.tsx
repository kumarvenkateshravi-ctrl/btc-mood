'use client';

import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradeOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  /** Execution owner of the values rendered by this row. */
  mode: 'live' | 'replay';
  entryPrice: number;
  side: 'long' | 'short';
  qty: number;
  /** Current-mode unrealized P&L for the open position (drives the pill colour). */
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
const ENTRY_RED = '#fb5168';
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
  const [y, setY] = useState<number | null>(null);

  useEffect(() => {
    if (!p.series) return;
    let raf: number;
    const update = () => {
      const nextY = p.series?.priceToCoordinate(p.entryPrice) ?? null;
      if (nextY !== null) {
        const roundedY = Math.round(nextY);
        setY((prev) => (prev !== roundedY ? roundedY : prev));
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [p.series, p.entryPrice]);

  if (y === null) return null;

  const chip = 'h-6 rounded border border-line bg-surface-1/95 px-2 text-[11px] leading-none text-ink hover:bg-surface-2';
  const primary = 'h-6 rounded bg-accent px-2.5 text-[11px] font-semibold leading-none text-white hover:opacity-90';

  const pnlStr = `${p.pnl >= 0 ? '+' : '−'}${Math.abs(p.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  const pillColor = p.side === 'long' ? ENTRY_BLUE : ENTRY_RED;
  const liveControls = p.mode === 'live';

  return (
    <div
      className="pointer-events-auto absolute right-[120px] z-[45] flex -translate-y-1/2 items-center gap-1"
      style={{ top: y }}
    >
      {liveControls && (
        <button type="button" className={chip} style={{ borderColor: pillColor }} title="Reverse position" onClick={p.onReverse}>
          ⇅
        </button>
      )}

      {liveControls && p.isDirty && (
        <>
          <button type="button" className={chip} onClick={p.onDiscard}>Discard</button>
          <button type="button" className={primary} onClick={p.onConfirm}>Confirm</button>
        </>
      )}

      {liveControls && (
        <>
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
        </>
      )}

      {/* qty | ±P&L | ✕ pill — gapped from the chips, floats left of the axis */}
      <div className="ml-3 flex h-6 items-center overflow-hidden rounded border" style={{ borderColor: pillColor }}>
        <span className="flex h-full items-center px-2 text-[11px] font-medium leading-none text-white" style={{ background: pillColor }}>
          {p.mode === 'replay' ? `Replay · ${p.qty}` : p.qty}
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
          title={p.mode === 'replay' ? 'Close replay trade' : 'Close trade'}
          className="flex h-full items-center border-l border-line bg-surface-1/95 px-1.5 text-[11px] leading-none text-ink-faint hover:text-bear-bright"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
