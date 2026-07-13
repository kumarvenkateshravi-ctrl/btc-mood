'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from './Chart';
import ChartErrorBoundary from '@/components/chart/ChartErrorBoundary';
import type { ChartProps } from './chart/types';
import type { Candle, Timeframe } from '@/lib/types';
import { tfsForPanes, type LayoutCount } from '@/lib/gridLayout';

export interface MultiPaneChartProps
  extends Omit<ChartProps, 'additionalPanes' | 'additionalPanesTotalHeight'> {
  /** Number of additional panes to render below the main candle pane. */
  paneCount: LayoutCount;
  /** Per-pane candles; length must match `paneCount`. v1: all use the active TF. */
  paneCandles: Candle[];
  /** Active TF. Used as the TF label for each pane in v1. */
  selected: Timeframe;
}

/**
 * TV-style multi-pane chart. One `Chart` instance with N additional
 * panes stacked below the main candle pane. LWC v5 shares the time
 * scale + crosshair across all panes, so pan/zoom and crosshair sync
 * are automatic. Indicators live in pane 0 (the main candle pane) per
 * TV behavior.
 */
export default function MultiPaneChart({
  paneCount,
  paneCandles,
  selected,
  ...chartProps
}: MultiPaneChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the additional-panes array. Each pane gets the same candles
  // (v1: all panes share the active TF — see tfsForPanes) with a stable
  // key based on its index so the hook can identify panes to add/remove.
  // Per-pane height is left to the hook's proportional allocation.
  const additionalPanes = useMemo(() => {
    void tfsForPanes(paneCount, selected); // future per-pane TF support
    return Array.from({ length: paneCount }, (_, i) => ({
      key: `pane-${i}`,
      candles: paneCandles,
    }));
  }, [paneCount, paneCandles, selected]);

  // Every pane (main + additional) gets an equal share of the container,
  // so the additional panes together get paneCount/(paneCount+1) of it.
  const additionalPanesTotalHeight = Math.max(
    0,
    Math.round((containerHeight * paneCount) / (paneCount + 1)),
  );

  return (
    <div ref={containerRef} className="h-full w-full">
      <ChartErrorBoundary>
        <Chart
          {...chartProps}
          additionalPanes={additionalPanes}
          additionalPanesTotalHeight={additionalPanesTotalHeight}
        />
      </ChartErrorBoundary>
    </div>
  );
}
