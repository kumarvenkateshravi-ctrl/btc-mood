import { useEffect } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import type { ChartRefs } from './refs';
import { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import { ChartFxPrimitive } from '@/lib/chartFxPrimitive';
import { chartApiStore } from '@/lib/chartApiStore';

export function useChartInit(refs: ChartRefs, height: number | string | undefined, tf?: string) {
  useEffect(() => {
    const { containerRef, paletteRef, chartRef, candleSeriesRef, dummySeriesRef, markersRef, overlayPrimitiveRef, fxPrimitiveRef } = refs;
    const container = containerRef.current;
    if (!container) return;

    const P = paletteRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || (typeof height === 'number' ? height : 600),
      layout: {
        background: { type: ColorType.Solid, color: P.chartBg },
        textColor: P.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        fontSize: 13,
        attributionLogo: false,
      },
      localization: {
        timeFormatter: (time: any) => {
          let date;
          if (typeof time === 'number') {
            date = new Date(time * 1000);
          } else if (time.year && time.month && time.day) {
            date = new Date(Date.UTC(time.year, time.month - 1, time.day));
          } else {
            return String(time);
          }
          return new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
            ...(typeof time === 'number' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {})
          }).format(date);
        },
      },
      grid: {
        vertLines: { color: P.grid, style: LineStyle.Solid },
        horzLines: { color: P.grid, style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderColor: P.border,
        scaleMargins: { top: 0.1, bottom: 0.24 },
        borderVisible: false,
      },
      timeScale: {
        // TradingView-style tick marks: year at year boundaries, month name
        // at month boundaries, day number at day boundaries — and REAL
        // time-of-day for intraday ticks. (Times are pre-shifted by
        // shiftTime(), so UTC getters render the intended wall-clock.)
        tickMarkFormatter: (time: any, tickType: number) => {
          // tickType: 0=year, 1=month, 2=day, 3=time, 4=seconds
          let date: Date;
          if (typeof time === 'number') {
            date = new Date(time * 1000);
          } else if (time.year && time.month && time.day) {
            date = new Date(Date.UTC(time.year, time.month - 1, time.day));
          } else {
            return String(time);
          }
          if (tickType === 0) {
            return date.getUTCFullYear().toString();
          }
          if (tickType === 1) {
            return date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
          }
          if (tickType === 2) {
            return date.getUTCDate().toString();
          }
          // Intraday (and seconds) ticks: HH:MM — collapsing these to the
          // day number is what wiped time-of-day off the axis.
          const hh = date.getUTCHours().toString().padStart(2, '0');
          const mm = date.getUTCMinutes().toString().padStart(2, '0');
          return `${hh}:${mm}`;
        },
        borderColor: P.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 14,
        minBarSpacing: 0.5,
        borderVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: P.crosshairLine,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: P.crosshairLabelBg,
        },
        horzLine: {
          color: P.crosshairLine,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: P.crosshairLabelBg,
        },
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: P.bullFace,
      downColor: P.bearFace,
      borderUpColor: P.bullSide,
      borderDownColor: P.bearSide,
      wickUpColor: P.bullWick,
      wickDownColor: P.bearWick,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      wickVisible: true,
      borderVisible: true,
    });

    const dummySeries = chart.addSeries(LineSeries, {
      visible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    });

    const markers = createSeriesMarkers(candleSeries, []);

    const orderOverlay = new OrderOverlayPrimitive();
    candleSeries.attachPrimitive(orderOverlay);

    const fx = new ChartFxPrimitive();
    candleSeries.attachPrimitive(fx);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    dummySeriesRef.current = dummySeries;
    markersRef.current = markers;
    overlayPrimitiveRef.current = orderOverlay;
    fxPrimitiveRef.current = fx;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      // Minimize/restore (Win+Down, taskbar) reports 0x0 for a frame. Feeding
      // zero sizes into lightweight-charts' canvas math crashes deep inside
      // ('Value is null'). Skip the frame — the restore emits a real-size
      // entry right after, so nothing is lost.
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      if (chartRef.current) {
        try {
          chartRef.current.applyOptions({ width: rect.width, height: rect.height });
        } catch (err) {
          console.warn('[chart] resize failed — will recover on next layout:', err);
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      dummySeriesRef.current = null;
      markersRef.current = null;
      overlayPrimitiveRef.current = null;
      fxPrimitiveRef.current = null;

      refs.indicatorSeriesRef.current.clear();
      refs.indicatorPanesRef.current.clear();
      refs.indicatorGradientRef.current.clear();
      refs.indicatorBandRef.current.clear();
      refs.indicatorMarkersRef.current.clear();
      refs.indicatorSigRef.current = '';
      refs.lastBarTimeRef.current = null;
      refs.firstBarTimeRef.current = null;
      refs.hoverInputsRef.current = { src: [], base: [], isRenko: false };
      refs.initialZoomDoneRef.current = false;
      refs.setHover(null);
      refs.setHoverLine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs]);

  // Register this chart in the keyed registry. Separate effect so a tf
  // change re-keys the entry without recreating the chart. Runs after the
  // init effect (chartRef is set); cleans up before it (reverse order), so
  // unregister always precedes chart.remove().
  useEffect(() => {
    const chart = refs.chartRef.current;
    if (!chart) return;
    const key = tf ?? 'default';
    chartApiStore.register(key, chart);
    return () => chartApiStore.unregister(key, chart);
  }, [refs, tf]);
}
