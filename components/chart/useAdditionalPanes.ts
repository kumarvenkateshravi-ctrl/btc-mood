'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPaneApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import type { Candle } from '@/lib/types';
import { shiftTime } from './types';
import { ensureCleanSeries } from './types';

/**
 * A single additional pane (below the main candle pane) that renders a
 * second candlestick series from a different timeframe's data. Used by
 * `MultiPaneChart` to build the TV-style "4 panes stacked" view.
 */
export interface AdditionalPane {
  /** Unique key — used as a stable React key for the pane entry. */
  key: string;
  candles: Candle[];
  /** Fixed pane height in px. Defaults to a sensible share of the parent. */
  height?: number;
}

interface PaneEntry {
  pane: IPaneApi<Time>;
  series: ISeriesApi<'Candlestick'>;
  // Last-pushed data shape, so live ticks use series.update() instead of a
  // full setData() (which is far too heavy to run per-tick × N panes).
  lastCount: number;
  lastFirstTime: number | null;
  lastLastTime: number | null;
  lastHeight: number;
}

function toBar(c: Candle): CandlestickData<Time> {
  return {
    time: shiftTime(c.time as number),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

/**
 * Owns the lifecycle of N additional panes + their candlestick series
 * below the main pane. Pane height is recomputed proportionally on
 * container resize (the caller passes a ResizeObserver-fired height).
 *
 * Panes are allocated in order — the first entry becomes pane index 1,
 * the second pane index 2, etc. The main candle pane keeps index 0.
 */
export function useAdditionalPanes(
  chartRef: React.RefObject<IChartApi | null>,
  panes: AdditionalPane[] | undefined,
  /** Total height available to ALL additional panes combined, in px. */
  totalHeight: number,
) {
  const entriesRef = useRef<Map<string, PaneEntry>>(new Map());
  const paneSigRef = useRef<string>('');
  // The chart instance the current entries were created on. The chart can be
  // torn down and recreated without this component remounting (StrictMode
  // dev double-mount, and refs outlive the chart), so stale entries/sig must
  // be dropped whenever the instance changes.
  const entriesChartRef = useRef<IChartApi | null>(null);

  // (Re)allocate panes when the list shape changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (entriesChartRef.current !== chart) {
      entriesChartRef.current = chart;
      entriesRef.current.clear();
      paneSigRef.current = '';
    }
    const list = panes ?? [];
    const sig = list.map((p) => p.key).join('|');
    if (sig === paneSigRef.current) return;
    paneSigRef.current = sig;

    // Remove stale entries not in the new list. Removing the pane's only
    // series auto-removes the pane (addPane defaults preserveEmptyPane=false).
    for (const [key, entry] of [...entriesRef.current.entries()]) {
      if (!list.some((p) => p.key === key)) {
        try { chart.removeSeries(entry.series); } catch {}
        entriesRef.current.delete(key);
      }
    }

    // Add new panes (addPane appends at the end).
    for (const p of list) {
      if (entriesRef.current.has(p.key)) continue;
      const pane = chart.addPane();
      const series = chart.addSeries(
        CandlestickSeries,
        {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
          priceLineVisible: true,
          priceLineWidth: 1,
          priceLineStyle: LineStyle.Dashed,
          lastValueVisible: true,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
          wickVisible: true,
          borderVisible: true,
        },
        pane.paneIndex(),
      );
      // Each pane owns its own 'right' axis instance — style that one. (A
      // custom priceScaleId would create an invisible overlay scale.)
      try {
        chart.priceScale('right', pane.paneIndex()).applyOptions({
          visible: true,
          borderColor: '#2a3247',
          textColor: '#7b88a0',
          autoScale: true,
        });
      } catch {}
      entriesRef.current.set(p.key, {
        pane,
        series,
        lastCount: 0,
        lastFirstTime: null,
        lastLastTime: null,
        lastHeight: 0,
      });
    }
  }, [panes, chartRef]);

  // Push candle data + recompute heights when the list / data / totalHeight changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const list = panes ?? [];
    if (list.length === 0) return;

    const perPane = Math.max(80, Math.floor((totalHeight || 0) / list.length));

    for (const p of list) {
      const entry = entriesRef.current.get(p.key);
      if (!entry) continue;
      const h = p.height ?? perPane;
      if (h !== entry.lastHeight) {
        entry.lastHeight = h;
        try { entry.pane.setHeight(h); } catch {}
      }

      const n = p.candles.length;
      if (n === 0) continue;
      const firstTime = p.candles[0].time as number;
      const lastTime = p.candles[n - 1].time as number;
      // Same history, live tick or one appended bar → cheap update();
      // anything else (initial load, lazy-load prepend, TF switch, replay
      // scrub) → full setData().
      const sameHistory =
        entry.lastCount > 0 &&
        entry.lastFirstTime === firstTime &&
        (n === entry.lastCount ? entry.lastLastTime === lastTime : n === entry.lastCount + 1);
      try {
        if (sameHistory) {
          entry.series.update(toBar(p.candles[n - 1]));
        } else {
          const validCandles = ensureCleanSeries(p.candles.filter(c => c != null && Number.isFinite(c.time as number)));
          entry.series.setData(validCandles.map(toBar));
        }
        entry.lastCount = n;
        entry.lastFirstTime = firstTime;
        entry.lastLastTime = lastTime;
      } catch (err) {
        console.error(`useAdditionalPanes: data push failed for ${p.key}`, err);
      }
    }
  }, [panes, totalHeight, chartRef]);

  // Cleanup on unmount. The chart may already be disposed (its owner's
  // cleanup runs first), so always clear our state even when it's gone.
  useEffect(() => {
    return () => {
      const chart = chartRef.current;
      if (chart) {
        for (const entry of entriesRef.current.values()) {
          try { chart.removeSeries(entry.series); } catch {}
        }
      }
      entriesRef.current.clear();
      paneSigRef.current = '';
      entriesChartRef.current = null;
    };
    // chartRef is stable; no need to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
