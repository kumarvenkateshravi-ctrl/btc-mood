import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type ISeriesApi,
  type SeriesType,
  type SeriesMarker,
  type CandlestickData,
  type LineData,
  type WhitespaceData,
  type Time,
} from 'lightweight-charts';
import { IndicatorFillPrimitive } from '@/lib/indicatorFillPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import { IndicatorBandPrimitive } from '@/lib/indicatorBandPrimitive';
import type { Candle } from '@/lib/types';
import type { IndicatorSettings } from '@/lib/indicatorFramework';
import { shiftTime, getTfMinutes, ensureCleanSeries, type ChartType, type IndicatorRender } from './types';
import type { ChartRefs } from './refs';

/**
 * The core data-push effect: feeds candle data to the chart, generates the
 * right-edge whitespace, re-anchors the view after lazy-loaded prepends, and
 * rebuilds/syncs the entire indicator stack (signature-gated structural
 * rebuild + per-tick data push for every plot, gradient zone, and pane marker).
 *
 * Extracted verbatim from Chart.tsx — pure refactor, zero behavior change.
 */
export function useChartData(
  refs: ChartRefs,
  candles: Candle[],
  type: ChartType,
  tf: string | undefined,
  isRenko: boolean,
  visibleResults: IndicatorRender[],
  indicatorSettingsMap: Record<string, IndicatorSettings> | undefined,
  hiddenKeys: Set<string>,
  applyDefaultView: () => void,
) {
  const {
    chartRef,
    candleSeriesRef,
    dummySeriesRef,
    markersRef,
    indicatorSeriesRef,
    indicatorPanesRef,
    indicatorSigRef,
    indicatorGradientRef,
    indicatorBandRef,
    indicatorMarkersRef,
    separatePaneRef,
    hoverInputsRef,
    firstBarTimeRef,
    lastBarTimeRef,
    prevTypeRef,
    prevTfRef,
    prevOpenRef,
    prevCloseRef,
    lastCandleTimeRef,
  } = refs;

  // Previous bar count + first time, for append-by-one detection (smooth
  // replay playback / live bar close: series.update instead of full setData).
  const prevCountRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    if (candles.length === 0) return;

    const isNewContext = prevTfRef.current !== tf || prevTypeRef.current !== type;

    if (prevTypeRef.current !== null && prevTypeRef.current !== type) {
      // Full reset when chart type changes: clear series data AND all
      // tracking refs so stale Renko brick timestamps don't corrupt the
      // incremental update logic (isIncremental / isAppendOne) for the
      // new type. Without this reset, candleSeries.update() may be called
      // on an empty series, causing LWC to silently freeze the chart.
      try { candleSeries.setData([]); } catch {}
      try { markersRef.current?.setMarkers([]); } catch {}
      indicatorSeriesRef.current.forEach((s) => {
        try { s.setData([]); } catch {}
      });
      // Reset all state-tracking refs so the next render does a clean setData.
      lastBarTimeRef.current = null;
      firstBarTimeRef.current = null;
      prevCountRef.current = 0;
      prevFirstTimeRef.current = null;
    }
    prevTypeRef.current = type;
    prevTfRef.current = tf ?? null;

    // LWC #2044 guard 1: strictly ascending, unique timestamps only.
    const baseCandles = ensureCleanSeries(candles);
    hoverInputsRef.current = { src: baseCandles, base: baseCandles, isRenko };

    if (baseCandles.length === 0) return;

    // Initialize the hover store with the latest candle if it hasn't been set yet.
    // This ensures the OHLC strip at the top displays the latest values immediately.
    const lastBase = baseCandles[baseCandles.length - 1];
    const prevBase = baseCandles.length > 1 ? baseCandles[baseCandles.length - 2] : null;
    const lastSrc = isRenko ? lastBase : candles[candles.length - 1];
    refs.setHover({ src: lastSrc, base: lastBase, prevBase });
    refs.setHover(null); // Clears 'hover' but persists it in 'last'

    // Detect lazy-loaded older history (time-based modes only) so we can keep
    // the user's view anchored on the same bars after setData shifts indices.
    const canPreserveView = type !== 'renko';
    const newFirstTime = baseCandles[0].time as number;
    let prependedBars = 0;
    if (
      canPreserveView &&
      !isNewContext &&
      firstBarTimeRef.current != null &&
      newFirstTime < firstBarTimeRef.current
    ) {
      const oldFirst = firstBarTimeRef.current;
      const idx = baseCandles.findIndex((c) => (c.time as number) >= oldFirst);
      prependedBars = idx > 0 ? idx : 0;
    }
    const visRangeBefore =
      prependedBars > 0 ? chartRef.current?.timeScale().getVisibleLogicalRange() ?? null : null;

    const lastTime = baseCandles[baseCandles.length - 1].time;
    // In-bar tick: same last-bar time AND same bar count. The count check is
    // load-bearing for Renko: the forming (ghost) brick keeps the last-bar
    // time pinned to the source candle's time, so when price crosses a brick
    // boundary the array grows while lastTime stays constant — without the
    // count check the completed bricks would never be drawn (update() only
    // patches the final bar) and the chart falls further below live price
    // with every crossing.
    const isIncremental =
      lastBarTimeRef.current === lastTime && baseCandles.length === prevCountRef.current;
    // Append-by-one: one new bar at the tail, history untouched — a replay
    // step or a live bar close. LWC's update() appends in O(1); a multi-bar
    // jump or backward scrub falls through to the full setData path.
    const isAppendOne =
      !isNewContext &&
      !isIncremental &&
      prevFirstTimeRef.current === newFirstTime &&
      baseCandles.length === prevCountRef.current + 1 &&
      lastBarTimeRef.current != null &&
      (lastTime as number) > lastBarTimeRef.current;

    if (baseCandles.length > 0) {
      const last = baseCandles[baseCandles.length - 1];
      prevOpenRef.current = last.open;
      prevCloseRef.current = last.close;
      lastCandleTimeRef.current = last.time as number;
    }
    prevCountRef.current = baseCandles.length;
    prevFirstTimeRef.current = newFirstTime;

    // A malformed bar (NaN/null OHLC or time — a half-formed synthetic brick,
    // a bad ws frame) makes LWC throw "Value is null" INSIDE setData/update,
    // which crashes the whole page. Drop such bars; and if LWC still throws
    // (e.g. a just-disposed series surviving in a ref for one frame), reset
    // the tracking refs and skip this frame — the next tick repaints fully.
    //
    // IMPORTANT: `c` itself may be null if the history-prepend merge produced
    // a sparse array. The null check must come FIRST before any field access,
    // otherwise `.filter(isRenderable)` itself throws "Value is null at Array.map".
    const isRenderable = (c: { time: number | Time; open: number; high: number; low: number; close: number } | null | undefined): c is { time: number | Time; open: number; high: number; low: number; close: number } =>
      c != null &&
      Number.isFinite(c.time as number) &&
      Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close);
    const recoverNextFrame = (err: unknown) => {
      console.warn('[chart] series write failed — skipping frame, full repaint next tick:', err);
      lastBarTimeRef.current = null;
      prevCountRef.current = 0;
      prevFirstTimeRef.current = null;
    };

    if (isIncremental || isAppendOne) {
      const last = baseCandles[baseCandles.length - 1];
      if (isRenderable(last)) {
        try {
          candleSeries.update({
            time: shiftTime(last.time as number),
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
          });
        } catch (err) {
          recoverNextFrame(err);
          return;
        }
      }
      if (isAppendOne && dummySeriesRef.current && tf && !isRenko) {
        // Whitespace shifts by one bar; a single update extends it.
        try {
          dummySeriesRef.current.update({
            time: shiftTime((lastTime as number) + getTfMinutes(tf) * 60 * 300),
          });
        } catch {}
      }
      // Fall through — indicator plots still need sync (they recompute on
      // the appended bar), but the candle + whitespace series are done.
    } else {
      const candleData: CandlestickData<Time>[] = baseCandles
        .filter(isRenderable)
        .map((c) => ({
          time: shiftTime(c.time as number),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

      const futureData: WhitespaceData<Time>[] = [];
      if (tf && baseCandles.length > 0 && !isRenko) {
        const lastT = baseCandles[baseCandles.length - 1].time as number;
        const minutes = getTfMinutes(tf);
        if (Number.isFinite(lastT) && Number.isFinite(minutes)) {
          let t = lastT;
          for (let i = 1; i <= 300; i++) {
            t += minutes * 60;
            futureData.push({ time: shiftTime(t) });
          }
        }
      }

      // LWC #2044 guard 2: clear the crosshair before repainting a reshaped
      // dataset — its saved hover index points into the OLD bars; remapping
      // it during the prepend/reload throws 'Value is null' inside LWC's
      // own callbacks (uncatchable by React). It repaints on the next
      // mouse move, so the user never notices.
      try { chartRef.current?.clearCrosshairPosition(); } catch {}
      try {
        candleSeries.setData(candleData);
        if (dummySeriesRef.current) dummySeriesRef.current.setData(futureData);
      } catch (err) {
        recoverNextFrame(err);
        return;
      }
    }

    // Re-anchor the view after a prepend so the chart doesn't jump.
    if (prependedBars > 0 && visRangeBefore) {
      try {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: visRangeBefore.from + prependedBars,
          to: visRangeBefore.to + prependedBars,
        });
      } catch {}
    }
    firstBarTimeRef.current = newFirstTime;

    // Sync the custom indicator stack. Each indicator instance that has any
    // separate-pane plot gets its OWN pane below the candles. Building series +
    // panes is expensive and order-sensitive, so we only rebuild when the stack
    // *structure* changes (a signature of keys + plot shapes); per-tick we only
    // push fresh data into the already-created series.
    if (chartRef.current) {
      const chart = chartRef.current;
      const existing = indicatorSeriesRef.current;
      const panes = indicatorPanesRef.current;

      const signature = visibleResults
        .map((r) => {
          const settings = indicatorSettingsMap?.[r.key];
          const settingsSig = settings ? JSON.stringify({ styles: settings.styles, labelsOnPriceScale: settings.labelsOnPriceScale }) : '';
          const isHidden = hiddenKeys.has(r.key);
          return `${r.key}#${settingsSig}#${isHidden}#${r.result.plots.map((p) => `${p.id}:${p.type}:${p.pane ?? 'overlay'}`).join(',')}`;
        })
        .join('|');

      if (signature !== indicatorSigRef.current) {
        indicatorSigRef.current = signature;
        try { chart.clearCrosshairPosition(); } catch {}

        // Teardown: drop all indicator series, then all oscillator panes.
        // Removing a series detaches its primitives + price-lines + markers.
        for (const [, series] of existing) {
          try { chart.removeSeries(series); } catch {}
        }
        existing.clear();
        indicatorGradientRef.current.clear();
        // Band primitives live on the candle series (which survives teardown),
        // so detach them explicitly before dropping the refs.
        for (const [, bp] of indicatorBandRef.current) {
          try { candleSeriesRef.current?.detachPrimitive(bp); } catch {}
        }
        indicatorBandRef.current.clear();
        indicatorMarkersRef.current.clear();
        for (const pane of [...panes.values()].sort((a, b) => b.paneIndex() - a.paneIndex())) {
          try { chart.removePane(pane.paneIndex()); } catch {}
        }
        panes.clear();
        separatePaneRef.current = null;

        let styledPanes = false;
        for (const { key, result } of visibleResults) {
          const hasSeparate = result.plots.some((p) => p.pane === 'separate');
          let paneIndex = 0;
          if (hasSeparate) {
            const pane = chart.addPane();
            pane.setHeight(150);
            paneIndex = pane.paneIndex();
            panes.set(key, pane);
            chart.priceScale('right', paneIndex).applyOptions({
              visible: true,
              borderColor: '#2a3247',
              textColor: '#7b88a0',
              autoScale: true,
            });
            if (!styledPanes) {
              try {
                chart.applyOptions({
                  layout: {
                    panes: {
                      separatorColor: '#2a3247',
                      separatorHoverColor: 'rgba(154, 178, 215, 0.4)',
                    },
                  },
                });
              } catch {}
              styledPanes = true;
            }
          }

          for (const plot of result.plots) {
            const targetPane = plot.pane === 'separate' ? paneIndex : 0;
            const st = indicatorSettingsMap?.[key]?.styles?.[plot.id];
            const color = st?.color || plot.color;
            const lineWidth = (st?.thickness as 1 | 2 | 3 | 4) || (plot.lineWidth as 1 | 2 | 3 | 4) || 2;
            const isHidden = hiddenKeys.has(key);
            const visible = isHidden ? false : (st?.display !== false);
            const labelsOnPriceScale = indicatorSettingsMap?.[key]?.labelsOnPriceScale ?? true;
            // Price-scale labels: only the indicator's PRIMARY plot labels the
            // axis by default (TV-style; secondary lines like band edges or
            // basis lines were stacking pills). Plots can force with
            // axisLabel: true or suppress with axisLabel: false.
            const isPrimaryPlot = plot === result.plots[0];
            const axisLabels =
              plot.axisLabel === false
                ? false
                : plot.axisLabel === true
                  ? labelsOnPriceScale
                  : labelsOnPriceScale && isPrimaryPlot;
            let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | undefined;
            // LWC renders `title` on the price scale even with lastValueVisible
            // off, so non-labeled plots must blank it as well.
            const seriesTitle = axisLabels ? plot.title : '';
            if (plot.type === 'histogram') {
              series = chart.addSeries(
                HistogramSeries,
                { color, visible, priceLineVisible: axisLabels, lastValueVisible: axisLabels, title: seriesTitle },
                targetPane,
              );
            } else {
              series = chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth,
                  visible,
                  priceLineVisible: axisLabels,
                  lastValueVisible: axisLabels,
                  crosshairMarkerVisible: false,
                  title: seriesTitle,
                },
                targetPane,
              );
            }
            if (series) existing.set(`${key}::${plot.id}`, series);

            // `band` plots have no line data — a per-bar filled rectangle
            // primitive draws them (supply/demand zones etc.). Attach to the
            // CANDLE series: a primitive's priceToCoordinate uses its host
            // series' price mapping, and the band's own series is empty (no
            // range → null coordinates). The candle series has data and shares
            // the main price scale. Detached explicitly on teardown below.
            if (plot.type === 'band' && candleSeriesRef.current) {
              try {
                const bp = new IndicatorBandPrimitive();
                candleSeriesRef.current.attachPrimitive(bp);
                indicatorBandRef.current.set(`${key}::${plot.id}`, bp);
              } catch {}
            }
          }

          // Horizontal levels (hlines) + fills on the indicator's main series.
          const mainSeries = result.plots[0] ? existing.get(`${key}::${result.plots[0].id}`) : undefined;
          if (mainSeries) {
            for (const lv of result.levels ?? []) {
              try {
                mainSeries.createPriceLine({
                  price: lv.value,
                  color: lv.color,
                  lineWidth: (lv.lineWidth as 1 | 2 | 3 | 4) ?? 1,
                  lineStyle:
                    lv.lineStyle === 'dashed'
                      ? LineStyle.Dashed
                      : lv.lineStyle === 'dotted'
                        ? LineStyle.Dotted
                        : LineStyle.Solid,
                  axisLabelVisible: indicatorSettingsMap?.[key]?.labelsOnPriceScale ?? true,
                  title: lv.title ?? '',
                });
              } catch {}
            }
            if (result.fills && result.fills.length > 0) {
              try { mainSeries.attachPrimitive(new IndicatorFillPrimitive(result.fills)); } catch {}
            }
            if (result.gradientFills && result.gradientFills.length > 0) {
              try {
                const gp = new GradientZonePrimitive();
                mainSeries.attachPrimitive(gp);
                indicatorGradientRef.current.set(key, gp);
              } catch {}
            }
          }

          // Pane markers. Anchor: separate-pane indicators pin markers to
          // their own first series (e.g. divergence labels on the RSI line);
          // overlay indicators pin to the CANDLE series — an overlay's first
          // plot can be a band/annotation series with sparse data, and LWC
          // silently drops markers that fall on whitespace.
          if (result.markers) {
            const hasSeparate = result.plots.some((p) => p.pane === 'separate');
            const markerHost = hasSeparate && mainSeries ? mainSeries : candleSeriesRef.current;
            if (markerHost) {
              try { indicatorMarkersRef.current.set(key, createSeriesMarkers(markerHost, [])); } catch {}
            }
          }
        }
      }

      // Push data for every plot (every run).
      for (const { key, result } of visibleResults) {
        for (const plot of result.plots) {
          if (plot.type !== 'line' && plot.type !== 'histogram') continue;
          const series = existing.get(`${key}::${plot.id}`);
          if (!series) continue;
          const formatted = plot.data
            .map((v, i) => {
              if (v == null) return null;
              if (typeof v === 'object' && 'value' in v) {
                if (!Number.isFinite(v.value)) return null; // NaN AND ±Infinity (div-by-zero)
                return { time: shiftTime((candles[i]?.time ?? 0) as number), value: v.value, color: v.color };
              }
              if (!Number.isFinite(v as number)) return null;
              return { time: shiftTime((candles[i]?.time ?? 0) as number), value: v as number };
            })
            .filter((d): d is { time: Time; value: number; color?: string } => d !== null);
          if (formatted.length > 0) {
            try {
              series.setData(formatted as LineData[]);
            } catch (err) {
              console.error(`Failed to set indicator data for ${key}::${plot.id}:`, err);
            }
          }
        }

        // Band plots: feed each per-bar { upper, lower } + bar times into its
        // fill primitive (supply/demand zones etc.).
        for (const plot of result.plots) {
          if (plot.type !== 'band') continue;
          const bp = indicatorBandRef.current.get(`${key}::${plot.id}`);
          if (!bp) continue;
          const upper: (number | null)[] = [];
          const lower: (number | null)[] = [];
          for (const v of plot.data) {
            if (v != null && typeof v === 'object' && 'upper' in v && 'lower' in v
                && Number.isFinite(v.upper) && Number.isFinite(v.lower)) {
              upper.push(v.upper);
              lower.push(v.lower);
            } else {
              upper.push(null);
              lower.push(null);
            }
          }
          // Guard: `candles` is the RAW prop array; when old history is
          // prepended it can momentarily contain null entries before React
          // re-renders the full deduplicated list. A null here would throw
          // "Value is null at Array.map" — uncaught — and crash the page.
          const times = candles
            .filter((c) => c != null && Number.isFinite(c.time as number))
            .map((c) => shiftTime(c.time as number) as number);
          const st = indicatorSettingsMap?.[key]?.styles?.[plot.id];
          const visible = hiddenKeys.has(key) ? false : st?.display !== false;
          try { bp.setData(upper, lower, times, st?.color || plot.color, visible, plot.zoneStyle); } catch {}
        }

        // Gradient zones: feed the source plot's per-bar values + bar times.
        const gp = indicatorGradientRef.current.get(key);
        if (gp && result.gradientFills && result.gradientFills.length > 0) {
          const srcId = result.gradientFills[0].plotId;
          const srcPlot = result.plots.find((p) => p.id === srcId);
          if (srcPlot) {
            const vals = srcPlot.data.map((v) => {
              const n = v == null ? null : typeof v === 'object' && 'value' in v ? v.value : (v as number);
              return n != null && Number.isFinite(n) ? n : null;
            });
            const times = candles
              .filter((c) => c != null && Number.isFinite(c.time as number))
              .map((c) => shiftTime(c.time as number) as number);
            try { gp.setData(vals, times, result.gradientFills); } catch {}
          }
        }

        // Pane markers (e.g. divergence Bull/Bear).
        const mk = indicatorMarkersRef.current.get(key);
        if (mk && result.markers) {
          const markers = result.markers
            .filter((m) => {
              const c = candles[m.index];
              return c != null && Number.isFinite(c.time as number);
            })
            .map((m) => ({
              time: shiftTime(candles[m.index].time as number),
              position: m.position,
              color: m.color,
              shape: m.shape,
              text: m.text,
            }))
            .sort((a, b) => (a.time as number) - (b.time as number));
          try { mk.setMarkers(markers as SeriesMarker<Time>[]); } catch {}
        }
      }
    }

    lastBarTimeRef.current = lastTime;

    if (isNewContext && chartRef.current) {
      // Defer one frame so the chart has finished laying out before we measure width.
      requestAnimationFrame(() => applyDefaultView());
    }
  }, [candles, type, isRenko, tf, visibleResults, indicatorSettingsMap, hiddenKeys]);
}
