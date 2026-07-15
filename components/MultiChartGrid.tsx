'use client';

import { useMemo, useRef } from 'react';
import Chart, { type ChartType } from './Chart';
import ChartErrorBoundary from '@/components/chart/ChartErrorBoundary';
import type { ChartApi } from './chart/types';
import { useBaseCandles } from '@/lib/chartHelpers';
import { DEFAULT_RENKO, renkoConfigToOptions } from '@/lib/renko';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { Candle, Timeframe } from '@/lib/types';
import { LAYOUT_CONFIGS, type GridCount, type LayoutSync } from '@/lib/gridLayout';

/** Per-cell configuration — each chart owns its own timeframe, type and
 *  indicator set (edited from the main toolbar when the cell is selected). */
export interface GridCellConfig {
  tf: Timeframe;
  type: ChartType;
  indicatorIds: string[];
}

interface MultiChartGridProps {
  /** One entry per cell; length drives the grid column count. */
  cells: GridCellConfig[];
  candlesByTf: Record<Timeframe, Candle[]>;
  /** Index of the selected cell — the one the main toolbar controls. */
  selectedIndex: number;
  /** Click a cell to make it the toolbar target. */
  onSelectCell: (index: number) => void;
  /** Remove an indicator from a specific cell (on-chart legend × ). */
  onRemoveCellIndicator: (cellIndex: number, id: string) => void;
  /** Height of each cell's chart in px. */
  cellHeight?: number;
  /** Sync flags. crosshair / time / dateRange default false in v1
   *  to match TV; the user can toggle them on in the layout switcher. */
  sync?: LayoutSync;
}

const EMPTY_ARRAY: any[] = [];

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
  cells,
  candlesByTf,
  selectedIndex,
  onSelectCell,
  onRemoveCellIndicator,
  cellHeight = 240,
  sync,
}: MultiChartGridProps) {
  const count = cells.length as GridCount;
  // Multi-chart column count comes from the multi-chart layout config, NOT
  // the deprecated count-keyed GRID_COLS_CLASS (count is ambiguous across
  // modes: multi-pane::2 overwrote multi-chart::2's grid-cols-2 with
  // grid-cols-1, collapsing '2 charts side-by-side' into a single column).
  const colsClass = LAYOUT_CONFIGS[`multi-chart::${count}`]?.gridColsClass ?? 'grid-cols-2';
  const chartApis = useRef(new Map<number, ChartApi>());
  const syncingRange = useRef(false);
  const syncingCrosshair = useRef(false);

  const handleReady = (idx: number, api: ChartApi) => {
    chartApis.current.set(idx, api);

    // Back-compat: when no sync prop is passed, keep the legacy always-on
    // behavior. When passed, follow the layout's sync flags (defaults
    // inside the layout follow the TV default — OFF).
    const syncTime = sync ? sync.time : true;
    const syncCrosshair = sync ? sync.crosshair : true;

    if (syncTime) {
      api.subscribeLogicalRange((range) => {
        if (syncingRange.current || !range) return;
        syncingRange.current = true;
        chartApis.current.forEach((otherApi, otherIdx) => {
          if (otherIdx !== idx) {
            try { otherApi.setVisibleLogicalRange(range); } catch {}
          }
        });
        syncingRange.current = false;
      });
    }

    if (syncCrosshair) {
      api.subscribeCrosshairTime((time) => {
        if (syncingCrosshair.current) return;
        syncingCrosshair.current = true;
        chartApis.current.forEach((otherApi, otherIdx) => {
          if (otherIdx !== idx) {
            try { otherApi.setCrosshairTime(time); } catch {}
          }
        });
        syncingCrosshair.current = false;
      });
    }
  };

  return (
    <div
      role="grid"
      aria-label={`${count}-pane chart grid`}
      data-count={count}
      className={['grid gap-3 w-full h-full flex-1', colsClass, count > 2 ? 'grid-rows-2' : 'grid-rows-1'].join(' ')}
    >
      {cells.map((cell, i) => (
        <GridCell
          key={i}
          tf={cell.tf}
          candles={candlesByTf[cell.tf] ?? EMPTY_ARRAY}
          candlesByTf={candlesByTf}
          type={cell.type}
          activeIndicatorIds={cell.indicatorIds}
          active={i === selectedIndex}
          onSelect={() => onSelectCell(i)}
          onRemoveIndicator={(id) => onRemoveCellIndicator(i, id)}
          height={cellHeight}
          onReady={(api) => handleReady(i, api)}
        />
      ))}
    </div>
  );
}

function GridCell({
  tf,
  candles,
  candlesByTf,
  type,
  activeIndicatorIds,
  active,
  onSelect,
  onRemoveIndicator,
  height,
  onReady,
}: {
  tf: Timeframe;
  candles: Candle[];
  candlesByTf: Record<Timeframe, Candle[]>;
  type: ChartType;
  activeIndicatorIds: string[];
  active: boolean;
  onSelect: () => void;
  onRemoveIndicator: (id: string) => void;
  height: number;
  onReady: (api: ChartApi) => void;
}) {
  const renkoOptions = useMemo(() => renkoConfigToOptions(DEFAULT_RENKO), []);
  const baseCandlesForIndicators = useBaseCandles(candles, type, renkoOptions);

  // Recompute custom indicators on price tick or settings change
  const indicatorResults = useMemo(() => {
    if (candles.length === 0) return [];
    
    const computedSources: Record<string, (number | null)[]> = {};
    const results: Array<{ key: string; result: NonNullable<ReturnType<typeof CUSTOM_INDICATORS[number]['compute']>> }> = [];
    
    activeIndicatorIds.forEach((id) => {
      const baseId = id.split('::')[0];
      const def = CUSTOM_INDICATORS.find((d) => d.id === baseId);
      if (!def) return;
      
      let savedSettings;
      try {
        const defaultsStr = localStorage.getItem('indicator_defaults') || '{}';
        savedSettings = JSON.parse(defaultsStr)[baseId];
      } catch {}
      
      let result;
      try {
        result = def.compute(baseCandlesForIndicators, { id, settings: savedSettings }, computedSources);
      } catch (err) {
        console.error(`Indicator "${id}" failed to compute in GridCell:`, err);
        result = { plots: [], signals: Array.from({ length: baseCandlesForIndicators.length }, () => 'neutral' as const) };
      }
      
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
      onPointerDownCapture={onSelect}
      title="Click to control this chart from the toolbar"
      className={[
        'panel relative overflow-hidden rounded-xl border transition-all h-full min-h-0 cursor-pointer',
        active ? 'border-accent ring-1 ring-accent/60' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      {candles.length === 0 ? (
        <div
          className="flex items-center justify-center bg-chart-bg text-xs text-ink-faint"
          style={{ height }}
        >
          Loading {tf}…
        </div>
      ) : (
        <ChartErrorBoundary>
          <Chart
            candles={baseCandlesForIndicators}
            candlesByTf={candlesByTf}
            type={type}
            tf={tf}
            indicatorResults={indicatorResults}
            renko={renkoOptions}
            showSignals={false}
            activeIndicatorIds={activeIndicatorIds}
            activeIndicatorId={activeIndicatorIds[0] ?? ''}
            onIndicatorChange={() => {}}
            onRemoveIndicator={onRemoveIndicator}
            onReady={onReady}
          />
        </ChartErrorBoundary>
      )}
    </div>
  );
}