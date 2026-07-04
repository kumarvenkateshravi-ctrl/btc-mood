import { useEffect } from 'react';
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
import { shiftTime, getTfMinutes, type ChartType, type IndicatorRender } from './types';
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

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    if (candles.length === 0) return;

    const isNewContext = prevTfRef.current !== tf || prevTypeRef.current !== type;

    if (prevTypeRef.current !== null && prevTypeRef.current !== type) {
      candleSeries.setData([]);
      markersRef.current?.setMarkers([]);
      indicatorSeriesRef.current.forEach((s) => {
        try { s.setData([]); } catch {}
      });
    }
    prevTypeRef.current = type;
    prevTfRef.current = tf ?? null;

    const baseCandles = candles;
    hoverInputsRef.current = { src: candles, base: baseCandles, isRenko };

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
    const isIncremental = lastBarTimeRef.current === lastTime;

    if (baseCandles.length > 0) {
      const last = baseCandles[baseCandles.length - 1];
      prevOpenRef.current = last.open;
      prevCloseRef.current = last.close;
      lastCandleTimeRef.current = last.time as number;
    }

    if (isIncremental) {
      const last = baseCandles[baseCandles.length - 1];
      candleSeries.update({
        time: shiftTime(last.time as number),
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      // Fall through — indicator plots still need sync on incremental
      // ticks (e.g. settings change without candle update).
    }

    const candleData: CandlestickData<Time>[] = baseCandles.map((c) => ({
      time: shiftTime(c.time as number),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const futureData: WhitespaceData<Time>[] = [];
    if (tf && baseCandles.length > 0 && !isRenko) {
      const lastTime = baseCandles[baseCandles.length - 1].time as number;
      const minutes = getTfMinutes(tf);
      let t = lastTime;
      for (let i = 1; i <= 300; i++) {
        t += minutes * 60;
        futureData.push({ time: shiftTime(t) });
      }
    }

    candleSeries.setData(candleData);
    if (dummySeriesRef.current) dummySeriesRef.current.setData(futureData);

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

        // Teardown: drop all indicator series, then all oscillator panes.
        // Removing a series detaches its primitives + price-lines + markers.
        for (const [, series] of existing) {
          try { chart.removeSeries(series); } catch {}
        }
        existing.clear();
        indicatorGradientRef.current.clear();
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
            let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | undefined;
            if (plot.type === 'histogram') {
              series = chart.addSeries(
                HistogramSeries,
                { color, visible, priceLineVisible: labelsOnPriceScale, lastValueVisible: labelsOnPriceScale, title: plot.title },
                targetPane,
              );
            } else {
              series = chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth,
                  visible,
                  priceLineVisible: labelsOnPriceScale,
                  lastValueVisible: labelsOnPriceScale,
                  crosshairMarkerVisible: false,
                  title: plot.title,
                },
                targetPane,
              );
            }
            if (series) existing.set(`${key}::${plot.id}`, series);

            // `band` plots have no line data — a per-bar filled rectangle
            // primitive draws them (supply/demand zones etc.). Attached to the
            // band's own (empty) series so it detaches on the next teardown.
            if (series && plot.type === 'band') {
              try {
                const bp = new IndicatorBandPrimitive();
                series.attachPrimitive(bp);
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
            if (result.markers) {
              try { indicatorMarkersRef.current.set(key, createSeriesMarkers(mainSeries, [])); } catch {}
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
                if (Number.isNaN(v.value)) return null;
                return { time: shiftTime((candles[i]?.time ?? 0) as number), value: v.value, color: v.color };
              }
              if (Number.isNaN(v as number)) return null;
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
            if (v != null && typeof v === 'object' && 'upper' in v && 'lower' in v) {
              upper.push(v.upper);
              lower.push(v.lower);
            } else {
              upper.push(null);
              lower.push(null);
            }
          }
          const times = candles.map((c) => shiftTime(c.time as number) as number);
          const st = indicatorSettingsMap?.[key]?.styles?.[plot.id];
          bp.setData(upper, lower, times, st?.color || plot.color);
        }

        // Gradient zones: feed the source plot's per-bar values + bar times.
        const gp = indicatorGradientRef.current.get(key);
        if (gp && result.gradientFills && result.gradientFills.length > 0) {
          const srcId = result.gradientFills[0].plotId;
          const srcPlot = result.plots.find((p) => p.id === srcId);
          if (srcPlot) {
            const vals = srcPlot.data.map((v) =>
              v == null ? null : typeof v === 'object' && 'value' in v ? v.value : (v as number),
            );
            const times = candles.map((c) => shiftTime(c.time as number) as number);
            gp.setData(vals, times, result.gradientFills);
          }
        }

        // Pane markers (e.g. divergence Bull/Bear).
        const mk = indicatorMarkersRef.current.get(key);
        if (mk && result.markers) {
          const markers = result.markers
            .filter((m) => candles[m.index])
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
