'use client';

import { useMemo } from 'react';
import Chart, { type ChartType } from './Chart';
import { useBaseCandles } from '@/lib/chartHelpers';
import { DEFAULT_RENKO, renkoConfigToOptions } from '@/lib/renko';
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
  const renkoOptions = useMemo(() => renkoConfigToOptions(DEFAULT_RENKO), []);
  const baseCandlesForIndicators = useBaseCandles(candles, type, renkoOptions);

  // Recompute custom indicators on price tick or settings change
  const indicatorResults = useMemo(() => {
    if (candles.length === 0) return [];
    
    const computedSources: Record<string, (number | null)[]> = {};
    const results: Array<{ key: string; result: NonNullable<ReturnType<typeof CUSTOM_INDICATORS[number]['compute']>> }> = [];
    
    activeIndicatorIds.forEach((id) => {
      const def = CUSTOM_INDICATORS.find((d) => d.id === id);
      if (!def) return;
      
      let savedSettings;
      try {
        const defaultsStr = localStorage.getItem('indicator_defaults') || '{}';
        savedSettings = JSON.parse(defaultsStr)[id];
      } catch {}
      
      const result = def.compute(baseCandlesForIndicators, { id, settings: savedSettings }, computedSources);
      
      // Feed line/histogram plot outputs into the computed sources for downstream indicators
      result.plots.forEach((plot) => {
        if (plot.type === 'line' || plot.type === 'histogram') {
          const dataArr = plot.data.map((d) => {
            if (typeof d === 'number') return d;
            if (!d) return null;
            if ('value' in d) return d.value;
            return null;
          });
          computedSources[`${id}:${plot.id}`] = dataArr;
        }
      });
      
      results.push({ key: id, result });
    });
    
    return results;
  }, [baseCandlesForIndicators, activeIndicatorIds]);

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
          candles={baseCandlesForIndicators}
          type={type}
          height={height}
          tf={tf}
          indicatorResults={indicatorResults}
          renko={renkoOptions}
          showSignals={false}
          activeIndicatorId=""
          onIndicatorChange={() => {}}
        />
      )}
    </div>
  );
}