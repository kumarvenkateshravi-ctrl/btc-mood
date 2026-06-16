'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { toHeikinAshi } from '@/lib/heikinAshi';
import { toRenko } from '@/lib/renko';
import { ema } from '@/lib/indicators';
import { buildSignalFlips } from '@/lib/signalMarkers';
import { setHover, type HoverPayload } from '@/lib/chartHoverStore';
import { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import { ChartFxPrimitive, type FxBarRect } from '@/lib/chartFxPrimitive';
import type { Candle } from '@/lib/types';
import type { ComputedIndicator } from '@/lib/indicatorCompute';
import type { ActiveIndicator } from '@/components/trade/IndicatorPicker';
import { INDICATORS } from '@/lib/indicatorLibrary';

export type ChartType = 'candlestick' | 'heikinAshi' | 'renko';

export interface ChartIndicators {
  ema9: boolean;
  ema21: boolean;
}

export type OverlayKind = 'entry' | 'tp' | 'sl';

export interface ChartOverlay {
  kind: OverlayKind;
  price: number;
  draggable?: boolean;
  color?: string;
}

const C = {
  chartBg: '#11151f',
  text: '#e9eef7',
  textFaint: '#7b88a0',
  grid: '#1a2030',
  border: '#2a3247',
  crosshair: '#5aa2e6',
  crosshairLine: '#757575',
  bullFace: '#089981',
  bullTop: '#28b9a1',
  bullSide: '#007961',
  bullWick: '#089981',
  bullVol: 'rgba(8, 153, 129, 0.30)',
  bullHi: '#28b9a1',
  bullShade: '#007961',
  bullBorder: '#089981',
  downFace: '#f23645',
  downTop: '#ff5665',
  downSide: '#d21625',
  downWick: '#f23645',
  downVol: 'rgba(242, 54, 69, 0.30)',
  bearHi: '#ff5665',
  bearShade: '#d21625',
  bearBorder: '#f23645',
  emaFast: '#5aa2e6',
  emaSlow: '#f5b13b',
  entryLine: '#5aa2e6',
  tpLine: '#22d39a',
  slLine: '#fb5168',
} as const;

interface ChartProps {
  candles: Candle[];
  type: ChartType;
  tf?: string;
  height: number;
  indicators: ChartIndicators;
  showSignals?: boolean;
  brickSize?: number;
  autoBrick?: boolean;
  overlays?: ChartOverlay[];
  onOverlayDrag?: (kind: OverlayKind, price: number) => void;
  onOverlayChipClick?: (key: 'tp' | 'sl' | 'close') => void;
  overlaySide?: 'buy' | 'sell' | null;
  overlayUnitsLabel?: string;
  overlayTypeLabel?: string;
  overlayHasTp?: boolean;
  overlayHasSl?: boolean;
  overlayTpPrice?: number | null;
  overlaySlPrice?: number | null;
  overlayEntryPrice?: number | null;
  overlayLeverage?: number;
  onReady?: (api: { fitContent: () => void }) => void;
  regime?: number;
  overlayPnL?: number | null;
  onChartContextMenu?: (price: number, x: number, y: number) => void;
  customIndicators?: import('@/lib/indicatorCompute').ComputedIndicator[];
  activeIndicators?: import('@/components/trade/IndicatorPicker').ActiveIndicator[];
  showVolume?: boolean;
  onToggleVolume?: () => void;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  bid?: number | null;
  ask?: number | null;
  emaFastPeriod?: number;
  emaSlowPeriod?: number;
  onEmaToggle?: (key: 'ema9' | 'ema21') => void;
  onEmaPeriod?: (key: 'ema9' | 'ema21', period: number) => void;
  onIndicatorToggle?: (id: string) => void;
  onIndicatorRemove?: (id: string) => void;
  onIndicatorParam?: (id: string, key: string, value: number) => void;
}

export default function Chart({
  candles,
  type,
  tf,
  height,
  indicators,
  showSignals = true,
  brickSize,
  autoBrick,
  overlays = [],
  onOverlayDrag,
  onOverlayChipClick,
  overlaySide = null,
  overlayUnitsLabel = '—',
  overlayTypeLabel = 'Market',
  overlayHasTp = false,
  overlayHasSl = false,
  overlayTpPrice = null,
  overlaySlPrice = null,
  overlayEntryPrice = null,
  overlayLeverage = 10,
  onReady,
  regime = 0.2,
  overlayPnL = null,
  onChartContextMenu,
  customIndicators = [],
  activeIndicators = [],
  showVolume = true,
  onToggleVolume,
  onQuickTrade,
  bid = null,
  ask = null,
  emaFastPeriod = 9,
  emaSlowPeriod = 21,
  onEmaToggle,
  onEmaPeriod,
  onIndicatorToggle,
  onIndicatorRemove,
  onIndicatorParam,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const priceCardRef = useRef<HTMLDivElement | null>(null);
  const priceTextRef = useRef<HTMLDivElement | null>(null);
  const countdownTextRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const dummySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const overlayPrimitiveRef = useRef<OrderOverlayPrimitive | null>(null);
  const fxPrimitiveRef = useRef<ChartFxPrimitive | null>(null);
  const emaFastRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<'Line'> | null>(null);
  const customSeriesRef = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>(new Map());

  const [hover, setHoverLine] = useState<{
    kind: OverlayKind;
    price: number;
    y: number;
  } | null>(null);

  const onOverlayDragRef = useRef<typeof onOverlayDrag>(onOverlayDrag);
  const onOverlayChipClickRef = useRef<typeof onOverlayChipClick>(onOverlayChipClick);
  const onChartContextMenuRef = useRef<typeof onChartContextMenu>(onChartContextMenu);
  useEffect(() => {
    onOverlayDragRef.current = onOverlayDrag;
    onOverlayChipClickRef.current = onOverlayChipClick;
    onChartContextMenuRef.current = onChartContextMenu;
  }, [onOverlayDrag, onOverlayChipClick, onChartContextMenu]);

  const lastBarTimeRef = useRef<number | null>(null);
  const emaArraysRef = useRef<{
    closes: number[];
    fast: (number | null)[];
    slow: (number | null)[];
  }>({ closes: [], fast: [], slow: [] });

  const hoverInputsRef = useRef<{
    src: Candle[];
    base: Candle[];
    isRenko: boolean;
  }>({ src: [], base: [], isRenko: false });

  const prevTypeRef = useRef<ChartType | null>(null);
  const initialZoomDoneRef = useRef(false);
  const prevOpenRef = useRef<number | null>(null);
  const prevCloseRef = useRef<number | null>(null);
  const prevTfRef = useRef<string | null>(null);
  const lastCandleTimeRef = useRef<number | null>(null);

  function getTfMinutes(tfStr: string): number {
    switch (tfStr) {
      case '1m': return 1;
      case '5m': return 5;
      case '15m': return 15;
      case '1h': return 60;
      case '4h': return 240;
      case '1d': return 1440;
      default: return 15;
    }
  }

  // ---- Chart creation ----
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: C.chartBg },
        textColor: '#d1d4dc',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid, style: LineStyle.Solid },
        horzLines: { color: C.grid, style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.1, bottom: 0.24 },
        borderVisible: false,
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 14,
        minBarSpacing: 6,
        borderVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: C.crosshairLine,
          width: 1,
          style: LineStyle.LargeDashed,
          labelBackgroundColor: C.crosshair,
        },
        horzLine: {
          color: C.crosshairLine,
          width: 1,
          style: LineStyle.LargeDashed,
          labelBackgroundColor: C.crosshair,
        },
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.bullFace,
      downColor: C.downFace,
      borderUpColor: C.bullSide,
      borderDownColor: C.downSide,
      wickUpColor: C.bullWick,
      wickDownColor: C.downWick,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      wickVisible: true,
      borderVisible: true,
    });

    const emaFast = chart.addSeries(LineSeries, {
      color: C.emaFast,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: `EMA ${emaFastPeriod}`,
    });
    const emaSlow = chart.addSeries(LineSeries, {
      color: C.emaSlow,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: `EMA ${emaSlowPeriod}`,
    });

    const dummySeries = chart.addSeries(LineSeries, {
      visible: false,
      priceLineVisible: false,
      lastValueVisible: false,
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
    emaFastRef.current = emaFast;
    emaSlowRef.current = emaSlow;

    const onCrosshair = (param: MouseEventParams) => {
      const cs = candleSeriesRef.current;
      const { src, base: baseCandles, isRenko: renko } = hoverInputsRef.current;
      if (!cs || baseCandles.length === 0) {
        setHover(null);
        return;
      }
      if (!param.time || param.point === undefined) {
        setHover(null);
        return;
      }
      const timeSec = param.time as number | string;
      if (typeof timeSec !== 'number') {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(cs) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!data) {
        setHover(null);
        return;
      }
      const idx =
        typeof param.logical === 'number'
          ? param.logical
          : baseCandles.length - 1;
      const base = baseCandles[idx];
      if (!base) {
        setHover(null);
        return;
      }
      const srcCandle = renko ? base : src[idx];
      if (!srcCandle) {
        setHover(null);
        return;
      }
      const prevIdx = idx > 0 ? idx - 1 : -1;
      const prevBase = prevIdx >= 0 ? baseCandles[prevIdx] ?? null : null;
      const payload: HoverPayload = {
        src: srcCandle,
        base,
        prevBase,
        emaFast: emaArraysRef.current.fast[idx] ?? null,
        emaSlow: emaArraysRef.current.slow[idx] ?? null,
      };
      setHover(payload);
    };
    chart.subscribeCrosshairMove(onCrosshair);

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) {
        chartRef.current.applyOptions({ width: w });
      }
    });
    ro.observe(containerRef.current);

    const container = containerRef.current;

    // ---- Instant Price-axis (Y) wheel zoom ----
    const onAxisWheel = (e: WheelEvent) => {
      const c = chartRef.current;
      const series = candleSeriesRef.current;
      if (!c || !series) return;
      const rect = container.getBoundingClientRect();
      const ps = c.priceScale('right');
      const axisW = ps.width();
      if (e.clientX < rect.right - axisW - 1) return;
      
      e.preventDefault();
      e.stopPropagation();

      const paneH = rect.height - c.timeScale().height();
      if (paneH <= 0) return;
      const cursorY = e.clientY - rect.top;
      const margins = ps.options().scaleMargins;

      let range = ps.getVisibleRange();
      if (!range) {
        const high = series.coordinateToPrice(paneH * margins.top);
        const low = series.coordinateToPrice(paneH * (1 - margins.bottom));
        if (high == null || low == null || high <= low) return;
        range = { from: low, to: high };
      }
      ps.setAutoScale(false);

      const { from, to } = range;
      const span = to - from;
      if (!(span > 0)) return;

      const dataTopY = paneH * margins.top;
      const dataBotY = paneH * (1 - margins.bottom);
      const frac = Math.min(1, Math.max(0, (cursorY - dataTopY) / (dataBotY - dataTopY)));
      const pivot = to - frac * span;

      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      const newFrom = pivot + (from - pivot) * factor;
      const newTo = pivot + (to - pivot) * factor;
      
      if (Number.isFinite(newFrom) && Number.isFinite(newTo) && newTo - newFrom > 0) {
        ps.setVisibleRange({ from: newFrom, to: newTo });
      }
    };
    container.addEventListener('wheel', onAxisWheel, { passive: false, capture: true });


    // ---- Overlay drag + body pan ----
    let dragKind: 'entry' | 'tp' | 'sl' | null = null;
    let dragPointerId: number | null = null;
    let bodyPanPointerId: number | null = null;
    let bodyPanStartY: number = 0;
    let bodyPanStartRange: { from: number; to: number } | null = null;
    const isDragKind = (k: string): k is 'entry' | 'tp' | 'sl' =>
      k === 'entry' || k === 'tp' || k === 'sl';

    const onPointerDown = (e: PointerEvent) => {
      const prim = overlayPrimitiveRef.current;
      const c = chartRef.current;
      const rect = container.getBoundingClientRect();
      const axisW = c?.priceScale('right').width() ?? 0;
      if (e.clientX >= rect.right - axisW - 1) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      if (prim && c) {
        const hit = prim.customHitTest(localX, localY);
        if (hit && hit.draggable) {
          const k = hit.kind;
          if (!isDragKind(k)) return;
          dragKind = k;
          dragPointerId = e.pointerId;
          prim.setDragging(k);
          try { container.setPointerCapture(e.pointerId); } catch {}
          e.preventDefault();
          e.stopPropagation();
          container.style.cursor = 'ns-resize';
          return;
        }
      }

      if (!c) return;
      const ps = c.priceScale('right');
      const series = candleSeriesRef.current;
      if (!series) return;
      let range = ps.getVisibleRange();
      if (!range) {
        const paneH = rect.height - c.timeScale().height();
        const margins = ps.options().scaleMargins;
        const high = series.coordinateToPrice(paneH * margins.top);
        const low = series.coordinateToPrice(paneH * (1 - margins.bottom));
        if (high == null || low == null || high <= low) return;
        range = { from: low, to: high };
        ps.setAutoScale(false);
        ps.setVisibleRange(range);
      }
      bodyPanPointerId = e.pointerId;
      bodyPanStartY = e.clientY;
      bodyPanStartRange = { from: range.from, to: range.to };
    };

    const onOverlayMove = (e: PointerEvent) => {
      if (dragKind === null || dragPointerId !== e.pointerId) return;
      const prim = overlayPrimitiveRef.current;
      const series = candleSeriesRef.current;
      if (!prim || !series) return;
      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const price = series.coordinateToPrice(localY);
      if (price == null || !Number.isFinite(price as number)) return;
      const newOverlays = prim.overlays.map((o) =>
        o.kind === dragKind ? { ...o, price: price as number } : o,
      );
      prim.setOverlays(newOverlays);
      onOverlayDragRef.current?.(dragKind, price as number);
      e.preventDefault();
      e.stopPropagation();
    };

    const endDrag = (e: PointerEvent) => {
      if (dragKind !== null && dragPointerId === e.pointerId) {
        dragKind = null;
        dragPointerId = null;
        overlayPrimitiveRef.current?.setDragging(null);
        container.style.cursor = '';
        try { container.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    const onBodyPanMove = (e: PointerEvent) => {
      if (bodyPanPointerId !== e.pointerId || !bodyPanStartRange) return;
      const c = chartRef.current;
      const series = candleSeriesRef.current;
      if (!c || !series) return;
      const dy = e.clientY - bodyPanStartY;
      const rect = container.getBoundingClientRect();
      const paneH = rect.height - c.timeScale().height();
      const margins = c.priceScale('right').options().scaleMargins;
      const dataTopY = paneH * margins.top;
      const dataBotY = paneH * (1 - margins.bottom);
      const dataH = dataBotY - dataTopY;
      if (dataH <= 0) return;
      const priceTop = series.coordinateToPrice(dataTopY);
      const priceBot = series.coordinateToPrice(dataBotY);
      if (priceTop == null || priceBot == null) return;
      const pricePerPx = (priceBot - priceTop) / dataH;
      const shift = dy * pricePerPx;
      c.priceScale('right').setVisibleRange({
        from: bodyPanStartRange.from + shift,
        to: bodyPanStartRange.to + shift,
      });
    };
    const onBodyPanUp = (e: PointerEvent) => {
      if (bodyPanPointerId !== e.pointerId) return;
      bodyPanPointerId = null;
      bodyPanStartRange = null;
    };
    window.addEventListener('pointermove', onBodyPanMove, { passive: true });
    window.addEventListener('pointerup', onBodyPanUp);
    window.addEventListener('pointercancel', onBodyPanUp);

    const onHover = (e: PointerEvent) => {
      if (dragKind !== null) return;
      const prim = overlayPrimitiveRef.current;
      const series = candleSeriesRef.current;
      if (!prim || !series) return;
      const rect = container.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const localX = e.clientX - rect.left;
      const hit = prim.customHitTest(localX, localY);
      if (hit) {
        const price = series.coordinateToPrice(localY);
        if (price != null && Number.isFinite(price)) {
          setHoverLine({ kind: hit.kind, price: price as number, y: localY });
        }
      } else {
        let best: { kind: OverlayKind; y: number; price: number; dist: number } | null = null;
        const pad = 15;
        for (const o of prim.overlays) {
          if (!o.draggable) continue;
          const ly = series.priceToCoordinate(o.price);
          if (ly == null) continue;
          const d = Math.abs(localY - ly);
          if (d <= pad && (best == null || d < best.dist)) {
            best = { kind: o.kind, y: ly, price: o.price, dist: d };
          }
        }
        setHoverLine(best ? { kind: best.kind, price: best.price, y: best.y } : null);
      }
    };
    const onLeave = () => setHoverLine(null);
    const onContextMenu = (e: MouseEvent) => {
      const series = candleSeriesRef.current;
      const c = chartRef.current;
      if (!series || !c) return;
      const rect = container.getBoundingClientRect();
      const axisW = c.priceScale('right').width();
      if (e.clientX >= rect.right - axisW - 1) return;
      e.preventDefault();
      const localY = e.clientY - rect.top;
      const price = series.coordinateToPrice(localY);
      if (price == null || !Number.isFinite(price as number)) return;
      onChartContextMenuRef.current?.(price as number, e.clientX, e.clientY);
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('pointermove', onOverlayMove, { capture: true });
    container.addEventListener('pointermove', onHover, { capture: true });
    container.addEventListener('pointerleave', onLeave, { capture: true });
    container.addEventListener('pointerup', endDrag, { capture: true });
    container.addEventListener('pointercancel', endDrag, { capture: true });
    container.addEventListener('contextmenu', onContextMenu, { capture: true });

    onReady?.({ fitContent: () => chartRef.current?.timeScale().fitContent() });

    // ---- Unified Price & Countdown Timer Overlay ----
    let countdownRaf = 0;
    const updateCountdown = () => {
      countdownRaf = requestAnimationFrame(updateCountdown);
      const cardEl = priceCardRef.current;
      const priceEl = priceTextRef.current;
      const cdEl = countdownTextRef.current;
      const series = candleSeriesRef.current;
      if (!cardEl || !priceEl || !cdEl || !series) return;

      const isRenkoMode = hoverInputsRef.current.isRenko;
      const closeTime = lastCandleTimeRef.current;
      const priceVal = prevCloseRef.current;
      const y = priceVal != null ? series.priceToCoordinate(priceVal) : null;
      const axisW = chartRef.current?.priceScale('right').width() || 60;
      
      if (isRenkoMode || !tf || !closeTime || y == null || priceVal == null) {
        cardEl.style.display = 'none';
        return;
      }

      const diff = (closeTime + getTfMinutes(tf) * 60) * 1000 - Date.now();
      if (diff <= 0) {
        cdEl.textContent = '00:00';
      } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        if (h > 0) {
          cdEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          cdEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
      }
      
      const isGreen = prevOpenRef.current != null ? priceVal >= prevOpenRef.current : true;
      cardEl.style.backgroundColor = isGreen ? C.bullFace : C.downFace;
      priceEl.textContent = priceVal.toFixed(2);
      
      cardEl.style.display = 'flex';
      cardEl.style.top = `${y}px`;
      cardEl.style.width = `${axisW}px`;
    };
    countdownRaf = requestAnimationFrame(updateCountdown);

    return () => {
      ro.disconnect();
      if (countdownRaf) cancelAnimationFrame(countdownRaf);
      container.removeEventListener('wheel', onAxisWheel, { capture: true });

      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onOverlayMove, { capture: true });
      container.removeEventListener('pointerup', endDrag, { capture: true });
      container.removeEventListener('pointercancel', endDrag, { capture: true });
      container.removeEventListener('pointermove', onHover, { capture: true });
      container.removeEventListener('pointerleave', onLeave, { capture: true });
      container.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('pointermove', onBodyPanMove);
      window.removeEventListener('pointerup', onBodyPanUp);
      window.removeEventListener('pointercancel', onBodyPanUp);
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
      overlayPrimitiveRef.current = null;
      fxPrimitiveRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      lastBarTimeRef.current = null;
      emaArraysRef.current = { closes: [], fast: [], slow: [] };
      hoverInputsRef.current = { src: [], base: [], isRenko: false };
      initialZoomDoneRef.current = false;
      setHover(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, onReady]);

  // ---- Custom indicator series lifecycle ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const existing = customSeriesRef.current;
    const wanted = new Set<string>();
    const oscScaleId = 'oscillators';

    for (const ind of customIndicators) {
      const scaleId = ind.separatePane ? oscScaleId : undefined;
      for (let i = 0; i < ind.lines.length; i++) {
        const key = `${ind.id}:${i}`;
        wanted.add(key);
        if (existing.has(key)) continue;
        const line = ind.lines[i];
        const seriesOpts = {
          color: line.color,
          priceScaleId: scaleId,
          priceFormat: { type: 'price' as const, precision: 4, minMove: 0.0001 },
          lastValueVisible: false,
        };
        if (line.type === 'histogram') {
          existing.set(key, chart.addSeries(HistogramSeries, seriesOpts));
        } else {
          existing.set(key, chart.addSeries(LineSeries, {
            ...seriesOpts,
            lineWidth: 2,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          }));
        }
      }
    }

    try {
      chart.priceScale(oscScaleId).applyOptions({
        scaleMargins: { top: 0.65, bottom: 0.18 },
        visible: false,
      });
    } catch {}

    for (const [key, series] of existing) {
      if (!wanted.has(key)) {
        try { chart.removeSeries(series); } catch {}
        existing.delete(key);
      }
    }

    const hasOscillators = customIndicators.some((ind) => ind.separatePane && ind.lines.length > 0);
    try { chart.priceScale('oscillators').applyOptions({ visible: hasOscillators }); } catch {}
  }, [customIndicators]);

  // ---- Custom indicator data push ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const ind of customIndicators) {
      for (let i = 0; i < ind.lines.length; i++) {
        const key = `${ind.id}:${i}`;
        const series = customSeriesRef.current.get(key);
        if (!series) continue;

        const line = ind.lines[i];
        const data = line.values
          .map((v, idx) => (v != null ? { time: (candles[idx]?.time ?? 0) as Time, value: v } : null))
          .filter((d): d is { time: Time; value: number } => d !== null);

        if (data.length > 0) {
          try {
            if (line.type === 'histogram') {
              (series as ISeriesApi<'Histogram'>).setData(data as HistogramData<Time>[]);
            } else {
              (series as ISeriesApi<'Line'>).setData(data as LineData<Time>[]);
            }
          } catch {}
        }
      }
    }
  }, [customIndicators, candles]);

  const isRenko = type === 'renko';
  useEffect(() => {
    emaFastRef.current?.applyOptions({ visible: indicators.ema9 && !isRenko });
  }, [indicators.ema9, isRenko]);
  useEffect(() => {
    emaSlowRef.current?.applyOptions({ visible: indicators.ema21 && !isRenko });
  }, [indicators.ema21, isRenko]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      timeVisible: !isRenko,
      secondsVisible: false,
    });
  }, [isRenko]);

  // ---- Data push ----
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const emaFast = emaFastRef.current;
    const emaSlow = emaSlowRef.current;
    if (!candleSeries || !emaFast || !emaSlow) return;
    if (candles.length === 0) return;

    const isNewContext = prevTfRef.current !== tf || prevTypeRef.current !== type;

    if (prevTypeRef.current !== null && prevTypeRef.current !== type) {
      candleSeries.setData([]);
      emaFast.setData([]);
      emaSlow.setData([]);
      markersRef.current?.setMarkers([]);
    }
    prevTypeRef.current = type;
    prevTfRef.current = tf;

    const baseCandles =
      type === 'heikinAshi'
        ? toHeikinAshi(candles)
        : type === 'renko'
        ? toRenko(candles, { brickSize, autoBrick })
        : candles;
    const closes = candles.map((c) => c.close);
    const eFast = ema(closes, emaFastPeriod);
    const eSlow = ema(closes, emaSlowPeriod);
    emaArraysRef.current = { closes, fast: eFast, slow: eSlow };
    hoverInputsRef.current = { src: candles, base: baseCandles, isRenko };

    if (baseCandles.length === 0) return;

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
      const lastSrc = candles[candles.length - 1];
      candleSeries.update({
        time: last.time as Time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      if (!isRenko) {
        const ef = eFast[eFast.length - 1];
        const es = eSlow[eSlow.length - 1];
        if (ef != null) emaFast.update({ time: lastSrc.time as Time, value: ef });
        if (es != null) emaSlow.update({ time: lastSrc.time as Time, value: es });
      }
      return;
    }

    const candleData: CandlestickData<Time>[] = baseCandles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const fastData: LineData<Time>[] = [];
    if (!isRenko) {
      for (let i = 0; i < eFast.length; i++) {
        if (eFast[i] != null) {
          fastData.push({ time: candles[i].time as Time, value: eFast[i]! });
        }
      }
    }
    const slowData: LineData<Time>[] = [];
    if (!isRenko) {
      for (let i = 0; i < eSlow.length; i++) {
        if (eSlow[i] != null) {
          slowData.push({ time: candles[i].time as Time, value: eSlow[i]! });
        }
      }
    }

    const futureData: WhitespaceData<Time>[] = [];
    if (tf && baseCandles.length > 0 && !isRenko) {
      const lastTime = baseCandles[baseCandles.length - 1].time as number;
      const minutes = getTfMinutes(tf);
      let t = lastTime;
      for (let i = 1; i <= 300; i++) {
        t += minutes * 60;
        futureData.push({ time: t as Time });
      }
    }

    candleSeries.setData(candleData);
    if (dummySeriesRef.current) dummySeriesRef.current.setData(futureData);
    emaFast.setData(fastData);
    emaSlow.setData(slowData);
    lastBarTimeRef.current = lastTime;

    if (isNewContext && chartRef.current) {
      const timeScale = chartRef.current.timeScale();
      const toIndex = baseCandles.length - 1 + 10; // Force exact 10 bar gap
      const barsOnScreen = timeScale.width() / 14; // Default barSpacing is 14
      timeScale.setVisibleLogicalRange({
        from: toIndex - barsOnScreen,
        to: toIndex,
      });
    }
  }, [candles, type, brickSize, autoBrick, isRenko, emaFastPeriod, emaSlowPeriod, tf]);

  useEffect(() => {
    emaFastRef.current?.applyOptions({ title: `EMA ${emaFastPeriod}` });
  }, [emaFastPeriod]);
  useEffect(() => {
    emaSlowRef.current?.applyOptions({ title: `EMA ${emaSlowPeriod}` });
  }, [emaSlowPeriod]);

  // ---- FX: bear hatching ----
  useEffect(() => {
    const fx = fxPrimitiveRef.current;
    const s = candleSeriesRef.current;
    const c = chartRef.current;
    if (!fx || !s || !c) return;
    if (candles.length === 0) {
      fx.setOptions({ bars: [], latestIndex: -1 });
      return;
    }
    const baseCandles =
      type === 'heikinAshi'
        ? toHeikinAshi(candles)
        : type === 'renko'
        ? toRenko(candles, { brickSize, autoBrick })
        : candles;
    if (baseCandles.length === 0) {
      fx.setOptions({ bars: [], latestIndex: -1 });
      return;
    }
    const rects: FxBarRect[] = [];
    const start = Math.max(0, baseCandles.length - 600);
    for (let i = start; i < baseCandles.length; i++) {
      const b = baseCandles[i];
      const top = s.priceToCoordinate(Math.max(b.open, b.close));
      const bot = s.priceToCoordinate(Math.min(b.open, b.close));
      const x = c.timeScale().timeToCoordinate(b.time as Time);
      if (top == null || bot == null || x == null) continue;
      rects.push({
        time: b.time as Time,
        x,
        w: 7,
        y: top,
        h: bot - top,
      });
    }
    fx.setOptions({ bars: rects, latestIndex: rects.length - 1 });
  }, [candles, type, brickSize, autoBrick]);

  // ---- Pulse ----
  useEffect(() => {
    const fx = fxPrimitiveRef.current;
    if (!fx) return;
    if (candles.length === 0) {
      prevCloseRef.current = null;
      return;
    }
    const last = candles[candles.length - 1];
    const prev = prevCloseRef.current;
    prevCloseRef.current = last.close;
    if (prev == null || last.close === prev) return;
    fx.setOptions({
      pulseAt: performance.now(),
      pulseDir: last.close > prev ? 'up' : 'down',
    });
  }, [candles]);

  // ---- Signal markers ----
  useEffect(() => {
    const mk = markersRef.current;
    if (!mk) return;
    if (!showSignals || isRenko || candles.length === 0) {
      mk.setMarkers([]);
      return;
    }
    const markers: SeriesMarker<Time>[] = buildSignalFlips(candles).map((f) => ({
      time: f.time as Time,
      position: f.side === 'buy' ? 'belowBar' : 'aboveBar',
      shape: f.side === 'buy' ? 'arrowUp' : 'arrowDown',
      color: f.side === 'buy' ? C.bullFace : C.downFace,
      text: f.side === 'buy' ? 'BUY' : 'SELL',
    }));
    mk.setMarkers(markers);
  }, [candles, isRenko, showSignals]);

  // ---- Order overlays sync ----
  useEffect(() => {
    const prim = overlayPrimitiveRef.current;
    if (!prim) return;
    prim.options.side = overlaySide;
    prim.options.unitsLabel = overlayUnitsLabel;
    prim.options.typeLabel = overlayTypeLabel;
    prim.options.hasTp = overlayHasTp;
    prim.options.hasSl = overlayHasSl;
    prim.options.tpPrice = overlayTpPrice;
    prim.options.slPrice = overlaySlPrice;
    prim.options.entryPrice = overlayEntryPrice;
    prim.options.pnl = overlayPnL;
    prim.setOverlays(
      overlays
        .filter((o) => Number.isFinite(o.price) && o.price > 0)
        .map((o) => ({
          kind: o.kind,
          price: o.price,
          color: o.color,
          draggable: !!o.draggable,
        })),
    );
  }, [overlays, overlaySide, overlayUnitsLabel, overlayTypeLabel, overlayHasTp, overlayHasSl, overlayTpPrice, overlaySlPrice, overlayEntryPrice, overlayPnL]);

  // ---- Render ----
  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height, background: C.chartBg }}
    >
      <div
        ref={priceCardRef}
        className="pointer-events-none absolute right-0 z-[50] hidden flex-col items-stretch text-center font-mono tabular-nums tracking-tight text-white transition-colors duration-100"
        style={{ transform: 'translateY(-50%)' }}
      >
        <div ref={priceTextRef} className="py-[3px] text-[11px] font-semibold leading-none shadow-sm" />
        <div ref={countdownTextRef} className="pb-[4px] text-[10px] leading-none text-white/80" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(10, 14, 22, 0.45) 100%)',
        }}
      />
      {hover && (
        <OverlayTooltip
          kind={hover.kind}
          price={hover.price}
          y={hover.y}
          side={overlaySide}
          units={Number(overlayUnitsLabel) || 0}
          leverage={overlayLeverage}
          entryPrice={overlayEntryPrice}
        />
      )}
      <IndicatorLabels
        customIndicators={customIndicators}
        indicators={indicators}
        emaFast={emaArraysRef.current.fast}
        emaSlow={emaArraysRef.current.slow}
        emaFastPeriod={emaFastPeriod}
        emaSlowPeriod={emaSlowPeriod}
        candles={candles}
        isRenko={isRenko}
        activeIndicators={activeIndicators}
        showVolume={showVolume}
        onEmaToggle={onEmaToggle}
        onEmaPeriod={onEmaPeriod}
        onIndicatorToggle={onIndicatorToggle}
        onIndicatorRemove={onIndicatorRemove}
        onIndicatorParam={onIndicatorParam}
      />
      {onQuickTrade && (
        <div className="pointer-events-auto absolute left-2 top-2 z-10 flex gap-2">
          <button
            onClick={() => onQuickTrade('sell')}
            className="flex flex-col rounded-md bg-bear/20 px-3 py-1.5 text-xs ring-1 ring-bear/30 transition hover:bg-bear/30"
          >
            <span className="font-semibold text-bear-bright">Sell</span>
            {ask != null && Number.isFinite(ask) && (
              <span className="font-mono text-bear-bright/70">{ask.toFixed(1)}</span>
            )}
          </button>
          <button
            onClick={() => onQuickTrade('buy')}
            className="flex flex-col rounded-md bg-bull/20 px-3 py-1.5 text-xs ring-1 ring-bull/30 transition hover:bg-bull/30"
          >
            <span className="font-semibold text-bull-bright">Buy</span>
            {bid != null && Number.isFinite(bid) && (
              <span className="font-mono text-bull-bright/70">{bid.toFixed(1)}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Helper components ----

type LegendRow =
  | { kind: 'ema9' | 'ema21'; label: string; value: string; color: string; period: number; visible: boolean }
  | { kind: 'custom'; id: string; label: string; value: string; color: string; visible: boolean; def: import('@/lib/indicatorLibrary').IndicatorDef | undefined; params: Record<string, number> };

function formatLastValue(values: (number | null)[], decimals = 2): string {
  for (let j = values.length - 1; j >= 0; j--) {
    if (values[j] != null) return values[j]!.toFixed(decimals);
  }
  return '—';
}

function IndicatorLabels({
  customIndicators, indicators, emaFast, emaSlow, emaFastPeriod, emaSlowPeriod, isRenko,
  activeIndicators = [],
  onEmaToggle, onEmaPeriod, onIndicatorToggle, onIndicatorRemove, onIndicatorParam,
}: {
  customIndicators: ComputedIndicator[];
  indicators: ChartIndicators;
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  emaFastPeriod: number;
  emaSlowPeriod: number;
  candles: Candle[];
  isRenko: boolean;
  activeIndicators?: ActiveIndicator[];
  showVolume?: boolean;
  onEmaToggle?: (key: 'ema9' | 'ema21') => void;
  onEmaPeriod?: (key: 'ema9' | 'ema21', period: number) => void;
  onIndicatorToggle?: (id: string) => void;
  onIndicatorRemove?: (id: string) => void;
  onIndicatorParam?: (id: string, key: string, value: number) => void;
}) {
  const indicatorDefs = useMemo(() => new Map(INDICATORS.map((d) => [d.id, d])), []);
  const rows: LegendRow[] = useMemo(() => {
    const out: LegendRow[] = [];
    if (!isRenko) {
      out.push({ kind: 'ema9', label: `EMA ${emaFastPeriod}`, value: formatLastValue(emaFast), color: C.emaFast, period: emaFastPeriod, visible: indicators.ema9 });
      out.push({ kind: 'ema21', label: `EMA ${emaSlowPeriod}`, value: formatLastValue(emaSlow), color: C.emaSlow, period: emaSlowPeriod, visible: indicators.ema21 });
    }
    const seen = new Set<string>();
    for (const active of activeIndicators) {
      if (seen.has(active.id)) continue;
      seen.add(active.id);
      const def = indicatorDefs.get(active.id);
      const computed = customIndicators.find((c) => c.id === active.id);
      const label = def?.label ?? active.id;
      const color = computed?.lines[0]?.color ?? '#94a3b8';
      const value = computed ? formatLastValue(computed.lines[0]?.values ?? [], 4).replace(/\.?0+$/, '') : '—';
      out.push({ kind: 'custom', id: active.id, label, value, color, visible: active.visible, def, params: active.params });
    }
    return out;
  }, [indicatorDefs, isRenko, emaFast, emaSlow, emaFastPeriod, emaSlowPeriod, indicators.ema9, indicators.ema21, activeIndicators, customIndicators]);

  const [openSettings, setOpenSettings] = useState<string | null>(null);
  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-2 top-10 z-10 flex flex-col gap-1">
      {rows.map((row) => {
        const rowKey = row.kind === 'custom' ? `custom:${row.id}` : row.kind;
        const isOpen = openSettings === rowKey;
        return (
          <div key={rowKey} className="pointer-events-auto relative">
            <LegendRowView
              row={row}
              onToggle={() => {
                if (row.kind === 'custom') onIndicatorToggle?.(row.id);
                else onEmaToggle?.(row.kind);
              }}
              onRemove={() => {
                if (row.kind === 'custom') onIndicatorRemove?.(row.id);
                else onEmaToggle?.(row.kind);
              }}
              onSettings={() => setOpenSettings(isOpen ? null : rowKey)}
              isSettingsOpen={isOpen}
            />
            {isOpen && (
              <SettingsPopover
                row={row}
                onClose={() => setOpenSettings(null)}
                onEmaPeriod={onEmaPeriod}
                onIndicatorParam={onIndicatorParam}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LegendRowView({ row, onToggle, onRemove, onSettings, isSettingsOpen }: {
  row: LegendRow;
  onToggle: () => void;
  onRemove: () => void;
  onSettings: () => void;
  isSettingsOpen: boolean;
}) {
  const dim = !row.visible;
  return (
    <div className={['group inline-flex items-center gap-1.5 rounded-md border border-line/60 bg-surface-1/85 px-2 py-1 text-[10px] font-mono backdrop-blur-sm transition-opacity', dim ? 'opacity-55' : ''].join(' ')}>
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden />
      <span className="text-ink-faint">{row.label}</span>
      <span className={dim ? 'text-ink-faint line-through' : 'text-ink'}>{row.value}</span>
      <span className={['ml-1 flex items-center gap-0.5 transition-opacity', isSettingsOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'].join(' ')}>
        <IconBtn onClick={onToggle} ariaLabel={row.visible ? `Hide ${row.label}` : `Show ${row.label}`} title={row.visible ? 'Hide' : 'Show'}>
          {row.visible ? <EyeIcon /> : <EyeOffIcon />}
        </IconBtn>
        <IconBtn onClick={onSettings} ariaLabel={`Settings for ${row.label}`} title="Settings" active={isSettingsOpen}>
          <GearIcon />
        </IconBtn>
        <IconBtn onClick={onRemove} ariaLabel={`Remove ${row.label}`} title="Remove">
          <CloseIcon />
        </IconBtn>
      </span>
    </div>
  );
}

function IconBtn({ children, onClick, ariaLabel, title, active = false }: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  title: string;
  active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} title={title}
      className={['inline-flex h-4 w-4 items-center justify-center rounded text-ink-faint transition-colors', active ? 'text-ink bg-line/60' : 'hover:text-ink hover:bg-line/40'].join(' ')}>
      {children}
    </button>
  );
}

function EyeIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOffIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3l18 18" /><path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17.3 17.3 0 0 1-3.3 3.9" /><path d="M6.7 6.7A17.3 17.3 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.9" /></svg>;
}
function GearIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
}
function CloseIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

function SettingsPopover({ row, onClose, onEmaPeriod, onIndicatorParam }: {
  row: LegendRow;
  onClose: () => void;
  onEmaPeriod?: (key: 'ema9' | 'ema21', period: number) => void;
  onIndicatorParam?: (id: string, key: string, value: number) => void;
}) {
  return (
    <div role="dialog" className="absolute left-0 top-full z-20 mt-1 flex min-w-[180px] flex-col gap-2 rounded-lg border border-line bg-surface-1/95 p-2.5 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">{row.label}</span>
        <button type="button" aria-label="Close settings" onClick={onClose} className="inline-flex h-4 w-4 items-center justify-center rounded text-ink-faint hover:text-ink"><CloseIcon /></button>
      </div>
      {row.kind !== 'custom' ? (
        <NumberField label="Period" value={row.period} min={2} max={500} step={1} onChange={(v: number) => onEmaPeriod?.(row.kind, v)} />
      ) : !row.def || row.def.params.length === 0 ? (
        <p className="text-[10px] text-ink-faint">No editable parameters.</p>
      ) : (
        row.def.params.map((p) => (
          <NumberField key={p.key} label={p.label} value={row.params[p.key] ?? p.default} min={p.min} max={p.max} step={p.step} onChange={(v: number) => onIndicatorParam?.(row.id, p.key, v)} />
        ))
      )}
    </div>
  );
}

function NumberField({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[11px] text-ink-muted">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(n); }}
        className="w-20 rounded border border-line bg-base px-1.5 py-0.5 text-right font-mono text-[11px] text-ink outline-none focus:border-line-strong" />
    </label>
  );
}

function OverlayTooltip({ kind, price, y, side, units, leverage, entryPrice }: {
  kind: OverlayKind;
  price: number;
  y: number;
  side: 'buy' | 'sell' | null;
  units: number;
  leverage: number;
  entryPrice: number | null;
}) {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const notional = units > 0 && price > 0 ? units * price : null;
  const margin = units > 0 && price > 0 && leverage > 0 ? (units * price) / leverage : null;
  const liq =
    kind === 'entry' && side && entryPrice != null && leverage > 1
      ? side === 'buy' ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage)
      : null;
  const kindLabel =
    kind === 'entry' ? (side === 'buy' ? 'Entry (Buy)' : side === 'sell' ? 'Entry (Sell)' : 'Entry')
    : kind === 'tp' ? 'Take profit' : 'Stop loss';
  const kindColor =
    kind === 'entry'
      ? side === 'buy' ? 'border-bull/40 text-bull-bright' : 'border-bear/40 text-bear-bright'
      : kind === 'tp' ? 'border-bull/40 text-bull-bright' : 'border-regime-hot/40 text-regime-hot';
  return (
    <div className={['pointer-events-none absolute left-2 z-10 rounded-md border bg-surface-1/90 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur-md', kindColor].join(' ')}
      style={{ top: Math.max(8, Math.min(y - 22, (typeof window !== 'undefined' ? window.innerHeight : 600) - 80)) }}>
      <div className="flex items-center gap-2 font-medium">
        <span>{kindLabel}</span>
        <span className="font-mono text-ink">{fmt(price)}</span>
      </div>
      {kind === 'entry' && notional != null && (
        <div className="mt-0.5 flex gap-3 text-ink-faint">
          <span>Notional <span className="font-mono text-ink">${fmt(notional)}</span></span>
          <span>Margin <span className="font-mono text-ink">${fmt(margin ?? 0)}</span></span>
        </div>
      )}
      {liq != null && (
        <div className="mt-0.5 text-ink-faint">
          Liq <span className="font-mono text-bear-bright">${fmt(liq)}</span>
        </div>
      )}
    </div>
  );
}
