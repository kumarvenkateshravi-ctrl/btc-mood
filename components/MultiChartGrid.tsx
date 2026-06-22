'use client';

import { useMemo } from 'react';
import Chart, { type ChartType, type IndicatorRender } from './Chart';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { Candle, Timeframe } from '@/lib/types';
import { GRID_COLS_CLASS, type GridCount } from '@/lib/gridLayout';

interface MultiChartGridProps {
  /** Number of panes to render. Drives both the cell list and the
   *  CSS grid column count. */
  count: GridCount;
  /** Per-pane timeframe. Length must match `count`. */
  tfs: Timeframe[];
  candlesByTf: Record<Timeframe, Candle[]>;
  chartType: ChartType;
  activeIndicatorIds: string[];
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  /** Height of each cell's chart in px. */
  cellHeight?: number;
}

/**
 * Multi-chart grid — the "see more of the market in one glance" view.
 * Renders `count` cells, each a self-contained Chart at its assigned
 * TF. The grid root's `data-count` attribute picks the column count
 * via the `GRID_COLS_CLASS` mapping (no JS breakpoint gymnastics).
 *
 * Each cell is fully isolated: it owns its lightweight-charts
 * instance and re-renders independently on WS ticks. Indicators run
 * with default settings per cell.
 */
export default function MultiChartGrid({
  count,
  tfs,
  candlesByTf,
  chartType,
  activeIndicatorIds,
  selected,
  onSelectTf,
  cellHeight = 240,
}: MultiChartGridProps) {
  const colsClass = GRID_COLS_CLASS[count];

  return (
    <div
      role="grid"
      aria-label={`${count}-pane chart grid`}
      data-count={count}
      className={['grid gap-3', colsClass].join(' ')}
    >
      {tfs.map((tf) => (
        <GridCell
          key={tf}
          tf={tf}
          candles={candlesByTf[tf] ?? []}
          type={chartType}
          activeIndicatorIds={activeIndicatorIds}
          active={tf === selected}
          onSelect={() => onSelectTf(tf)}
          height={cellHeight}
        />
      ))}
    </div>
  );
}

function GridCell({
  tf,
  candles,
  type,
  activeIndicatorIds,
  active,
  onSelect,
  height,
}: {
  tf: Timeframe;
  candles: Candle[];
  type: ChartType;
  activeIndicatorIds: string[];
  active: boolean;
  onSelect: () => void;
  height: number;
}) {
  const indicatorResults = useMemo<IndicatorRender[]>(() => {
    if (candles.length === 0) return [];
    const out: IndicatorRender[] = [];
    for (const id of activeIndicatorIds) {
      const def = CUSTOM_INDICATORS.find((d) => d.id === id);
      if (def) out.push({ key: id, result: def.compute(candles, { id }) });
    }
    return out;
  }, [activeIndicatorIds, candles]);

  return (
    <div
      role="gridcell"
      className={[
        'panel relative overflow-hidden rounded-xl border transition-colors',
        active ? 'border-accent/50' : 'border-line',
      ].join(' ')}
    >
      <button
        onClick={onSelect}
        title={`Focus ${tf}`}
        className="focus-ring absolute right-2 top-2 z-10 rounded bg-base/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink backdrop-blur-sm transition hover:bg-surface-2"
      >
        {tf}
      </button>
      {candles.length === 0 ? (
        <div
          className="flex items-center justify-center bg-chart-bg text-xs text-ink-faint"
          style={{ height }}
        >
          Loading {tf}…
        </div>
      ) : (
        <Chart
          candles={candles}
          type={type}
          height={height}
          tf={tf}
          indicatorResults={indicatorResults}
          showSignals={false}
          activeIndicatorId=""
          onIndicatorChange={() => {}}
        />
      )}
    </div>
  );
}