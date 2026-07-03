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

export function useChartInit(refs: ChartRefs, height: number | string | undefined) {
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
      if (rect && chartRef.current) {
        chartRef.current.applyOptions({ width: rect.width, height: rect.height });
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
      refs.indicatorMarkersRef.current.clear();
      refs.indicatorSigRef.current = '';
      refs.lastBarTimeRef.current = null;
      refs.firstBarTimeRef.current = null;
      refs.hoverInputsRef.current = { src: [], base: [], isRenko: false };
      refs.initialZoomDoneRef.current = false;
      refs.setHover(null);
      refs.setHoverLine(null);
    };
  }, [refs, height]);
}
