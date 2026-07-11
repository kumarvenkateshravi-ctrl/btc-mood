'use client';

// TradingView-style floating chart navigation: zoom out / zoom in / pan left /
// pan right / reset view. Bottom-center pill that fades in while the cursor is
// over the chart (named group `group/chart` on the chart root). An alternative
// to wheel-zoom and drag-pan — one click per step, no keyboard needed.

import type { RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { Minus, Plus, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

/** Bars visible after max zoom-in / cap after repeated zoom-outs. */
const MIN_SPAN = 8;
const MAX_SPAN = 3000;
/** Fraction of the visible span moved per pan click. */
const PAN_STEP = 0.25;
/** Span multiplier per zoom click (in = ×0.7, out = ×1/0.7). */
const ZOOM_FACTOR = 0.7;

export function ChartNavControls({
  chartRef,
  onReset,
}: {
  chartRef: RefObject<IChartApi | null>;
  onReset: () => void;
}) {
  const zoom = (factor: number) => {
    const ts = chartRef.current?.timeScale();
    const range = ts?.getVisibleLogicalRange();
    if (!ts || !range) return;
    const span = range.to - range.from;
    const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * factor));
    if (next === span) return;
    const center = (range.from + range.to) / 2;
    ts.setVisibleLogicalRange({ from: center - next / 2, to: center + next / 2 });
  };

  const pan = (dir: 1 | -1) => {
    const ts = chartRef.current?.timeScale();
    const range = ts?.getVisibleLogicalRange();
    if (!ts || !range) return;
    const step = (range.to - range.from) * PAN_STEP * dir;
    ts.setVisibleLogicalRange({ from: range.from + step, to: range.to + step });
  };

  const btn =
    'focus-ring flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-1/95 text-ink-muted shadow-md transition-colors hover:bg-surface-2 hover:text-ink';

  return (
    <div
      // Floats well clear of the time-axis strip at the base of the canvas.
      className="pointer-events-auto absolute bottom-16 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover/chart:opacity-100 focus-within:opacity-100"
      // Chart canvas sits underneath — keep clicks from panning the chart.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <button type="button" className={btn} title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1 / ZOOM_FACTOR)}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Zoom in" aria-label="Zoom in" onClick={() => zoom(ZOOM_FACTOR)}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} title="Pan left (older)" aria-label="Pan left" onClick={() => pan(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Pan right (newer)" aria-label="Pan right" onClick={() => pan(1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <button type="button" className={btn} title="Reset view" aria-label="Reset view" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
