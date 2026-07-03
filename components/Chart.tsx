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
  PriceScaleMode,
  type IChartApi,
  type IPaneApi,
  type ISeriesApi,
  type SeriesType,
  type LogicalRange,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type CandlestickData,
  type LineData,
  type WhitespaceData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { setHover, type HoverPayload } from '@/lib/chartHoverStore';
import { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import { getChartPalette, useThemeName, type ChartPalette } from '@/lib/chartTheme';
import { ChartFxPrimitive, type FxBarRect } from '@/lib/chartFxPrimitive';
import { IndicatorFillPrimitive } from '@/lib/indicatorFillPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import type { Candle } from '@/lib/types';
import {
  type ChartType,
  type PriceScaleModeOption,
  type ChartApi,
  type IndicatorRender,
  type OverlayKind,
  type ChartOverlay,
  type ChartProps,
  shiftTime,
  getTfMinutes,
} from './chart/types';
import { OverlayTooltip } from './chart/OverlayTooltip';
import { FloatingChartTooltip } from './chart/FloatingChartTooltip';
import { ChartFloatingControls } from './chart/ChartFloatingControls';
import { ChartLegend } from './chart/ChartLegend';
import { useChartTheme } from './chart/useChartTheme';
import { usePriceScaleLines } from './chart/usePriceScaleLines';
import { useChartFx } from './chart/useChartFx';
import { useSignalMarkers } from './chart/useSignalMarkers';
import { useOrderOverlays } from './chart/useOrderOverlays';
import { useChartData } from './chart/useChartData';
import type { ChartRefs } from './chart/refs';
import { useDaySeparators } from './chart/useDaySeparators';

export type { ChartType, PriceScaleModeOption, ChartApi, ChartOverlay, OverlayKind, IndicatorRender } from './chart/types';

export default function Chart({
  candles,
  type,
  tf,
  height,
  indicatorResult = null,
  indicatorResults,
  priceScaleMode = 'normal',
  onPriceScaleModeChange,
  showSignals = true,
  renko,
  priceLines,
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
  onLoadOlder,
  overlayPnL = null,
  onChartContextMenu,
  onQuickTrade,
  onOpenRenkoSettings,
  bid = null,
  ask = null,
  activeIndicatorId,
  onIndicatorChange,
  onUpdateIndicatorSettings,
  activeIndicatorIds,
  indicatorSettingsMap,
  onRemoveIndicator,
  onUpdateIndicatorSettingsFor,
  resetTick,
}: ChartProps) {
  // Per-instance legend: which indicator's settings modal is open, and which
  // indicators are hidden (eye toggled off).
  const [settingsForKey, setSettingsForKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [isLegendExpanded, setIsLegendExpanded] = useState<boolean>(true);
  const [isScrolledBack, setIsScrolledBack] = useState<boolean>(false);

  // Normalize the single + stack props into one render list. Effects below
  // iterate this so one or many indicators render through the same path.
  const renderResults = useMemo<IndicatorRender[]>(() => {
    if (indicatorResults) return indicatorResults;
    if (indicatorResult) return [{ key: activeIndicatorId || 'main', result: indicatorResult }];
    return [];
  }, [indicatorResults, indicatorResult, activeIndicatorId]);

  // All active indicators are kept in structure so their panes don't collapse when hidden.
  // We simply turn off visibility of their plots.
  const visibleResults = useMemo<IndicatorRender[]>(
    () => renderResults,
    [renderResults],
  );

  // Live style edits (color / thickness / per-plot visibility) applied to
  // existing series without a structural rebuild. Series are keyed
  // `${instanceKey}::${plotId}`; styles live in indicatorSettingsMap[instanceKey].
  useEffect(() => {
    indicatorSeriesRef.current.forEach((series, seriesKey) => {
      const sep = seriesKey.indexOf('::');
      const instKey = sep >= 0 ? seriesKey.slice(0, sep) : seriesKey;
      const plotId = sep >= 0 ? seriesKey.slice(sep + 2) : seriesKey;
      const st = indicatorSettingsMap?.[instKey]?.styles?.[plotId];
      // If the entire indicator is hidden via the eye toggle, hide all its plots
      const isHidden = hiddenKeys.has(instKey);
      
      try {
        series.applyOptions({
          color: st?.color || undefined,
          lineWidth: (st?.thickness as 1 | 2 | 3 | 4) || undefined,
          visible: isHidden ? false : (st?.display !== false),
        });
      } catch {}
    });
  }, [indicatorSettingsMap, visibleResults, hiddenKeys]);

  // Live theme palette. The state drives JSX + applyOptions; the ref
  // feeds long-lived rAF/canvas closures without re-binding them. The
  // theme-apply effect below re-skins the chart in place (zoom and
  // scroll preserved) the moment the user switches themes.
  const themeName = useThemeName();
  const palette = getChartPalette(themeName);
  const paletteRef = useRef<ChartPalette>(palette);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const priceCardRef = useRef<HTMLDivElement | null>(null);
  const priceTextRef = useRef<HTMLDivElement | null>(null);
  const countdownTextRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const dummySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const overlayPrimitiveRef = useRef<OrderOverlayPrimitive | null>(null);
  const separatePaneRef = useRef<{ setHeight: (n: number) => void } | null>(null);
  // Per-instance oscillator panes: instanceKey -> pane. Plus a signature of the
  // current stack structure so we only rebuild series/panes when it changes.
  const indicatorPanesRef = useRef<Map<string, IPaneApi<Time>>>(new Map());
  const indicatorSigRef = useRef<string>('');
  const priceLinesRef = useRef<Map<string, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>(new Map());
  // Per-indicator gradient-zone primitives + marker plugins, keyed by instance.
  const indicatorGradientRef = useRef<Map<string, GradientZonePrimitive>>(new Map());
  const indicatorMarkersRef = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map());
  const [, setHasSeparatePane] = useState(false);
  const fxPrimitiveRef = useRef<ChartFxPrimitive | null>(null);
  const daySepCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const daySepRafRef = useRef<number>(0);

  const [hover, setHoverLine] = useState<{
    kind: OverlayKind;
    price: number;
    y: number;
  } | null>(null);
  
  // Local cursor position for the Phase D floating tooltip.
  // The data payload (OHLC) is passed directly so it persists when clicked.
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; time?: number; hover: HoverPayload } | null>(null);

  const onOverlayDragRef = useRef<typeof onOverlayDrag>(onOverlayDrag);
  const onOverlayChipClickRef = useRef<typeof onOverlayChipClick>(onOverlayChipClick);
  const onChartContextMenuRef = useRef<typeof onChartContextMenu>(onChartContextMenu);
  const onLoadOlderRef = useRef<typeof onLoadOlder>(onLoadOlder);
  useEffect(() => {
    onOverlayDragRef.current = onOverlayDrag;
    onOverlayChipClickRef.current = onOverlayChipClick;
    onChartContextMenuRef.current = onChartContextMenu;
    onLoadOlderRef.current = onLoadOlder;
  }, [onOverlayDrag, onOverlayChipClick, onChartContextMenu, onLoadOlder]);

  const lastBarTimeRef = useRef<number | null>(null);
  // First (oldest) bar time of the last render — used to detect prepended
  // history and keep the user's view anchored after a lazy-load.
  const firstBarTimeRef = useRef<number | null>(null);

  const hoverInputsRef = useRef<{
    src: Candle[];
    base: Candle[];
    isRenko: boolean;
  }>({ src: [], base: [], isRenko: false });

  const prevTypeRef = useRef<ChartType | null>(null);
  const initialZoomDoneRef = useRef(false);

  const isPointerDownRef = useRef(false);
  const lastCrosshairRef = useRef<{ point: { x: number; y: number }; time: number; payload: HoverPayload } | null>(null);

  // Applies the canonical default view: latest ~150 bars visible, 10-bar
  // gap between the last candle and the right edge (like TradingView).
  const applyDefaultView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const timeScale = chart.timeScale();
    const src = hoverInputsRef.current;
    const totalBars = src.base.length;
    if (totalBars === 0) return;
    const barSpacing = timeScale.options().barSpacing ?? 6;
    const visibleBars = Math.max(50, Math.round(timeScale.width() / barSpacing));
    const rightGap = 10; // bars of empty space to the right of the last candle
    const toIndex = totalBars - 1 + rightGap;
    const fromIndex = toIndex - visibleBars;
    try {
      timeScale.setVisibleLogicalRange({ from: fromIndex, to: toIndex });
    } catch {}
    try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch {}
  }, []);

  const prevOpenRef = useRef<number | null>(null);
  const prevCloseRef = useRef<number | null>(null);
  const prevTfRef = useRef<string | null>(null);
  const lastCandleTimeRef = useRef<number | null>(null);

  function getTfMinutes(tfStr: string): number {
    switch (tfStr) {
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

    const P = paletteRef.current;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || height,
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

    const onCrosshair = (param: MouseEventParams) => {
      const cs = candleSeriesRef.current;
      const { src, base: baseCandles, isRenko: renko } = hoverInputsRef.current;
      if (!cs || baseCandles.length === 0 || !param.time || param.point === undefined) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const timeSec = param.time as number | string;
      if (typeof timeSec !== 'number') {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const data = param.seriesData.get(cs) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!data) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const idx =
        typeof param.logical === 'number'
          ? param.logical
          : baseCandles.length - 1;
      const base = baseCandles[idx];
      if (!base) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const srcCandle = renko ? base : src[idx];
      if (!srcCandle) {
        setHover(null);
        lastCrosshairRef.current = null;
        if (isPointerDownRef.current) setTooltipPos(null);
        return;
      }
      const prevIdx = idx > 0 ? idx - 1 : -1;
      const prevBase = prevIdx >= 0 ? baseCandles[prevIdx] ?? null : null;
      const payload: HoverPayload = {
        src: srcCandle,
        base,
        prevBase,
      };
      
      if (lastCrosshairRef.current?.payload.base !== base || lastCrosshairRef.current?.time !== timeSec) {
        setHover(payload);
        lastCrosshairRef.current = { point: param.point, time: timeSec as number, payload };
        if (isPointerDownRef.current) {
          setTooltipPos({ x: param.point.x, y: param.point.y, time: timeSec as number, hover: payload });
        }
      } else {
        lastCrosshairRef.current.point = param.point;
        if (isPointerDownRef.current) {
          setTooltipPos({ x: param.point.x, y: param.point.y, time: timeSec as number, hover: payload });
        }
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);

    // Lazy-load older history when the user scrolls near the left edge.
    const onLogicalRange = (range: LogicalRange | null) => {
      if (range && range.from < 10) onLoadOlderRef.current?.();
      
      const ts = chartRef.current?.timeScale();
      if (ts) {
        // scrollPosition() < 0 means we have scrolled backward in time.
        setIsScrolledBack(ts.scrollPosition() < 0);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && chartRef.current) {
        chartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(containerRef.current);

    const container = containerRef.current;

    // ---- Instant Price-axis (Y) wheel zoom ----
    const onAxisWheel = (e: WheelEvent) => {
      const c = chartRef.current;
      if (!c) return;
      const rect = container.getBoundingClientRect();
      const cursorY = e.clientY - rect.top;

      let targetPane = null;
      let accumulatedHeight = 0;
      let paneLocalY = 0;
      for (const pane of c.panes()) {
        const h = pane.getHeight();
        if (cursorY >= accumulatedHeight && cursorY < accumulatedHeight + h) {
          targetPane = pane;
          paneLocalY = cursorY - accumulatedHeight;
          break;
        }
        accumulatedHeight += h;
      }

      if (!targetPane) return;

      const seriesList = targetPane.getSeries();
      const series = seriesList.length > 0 ? seriesList[0] : null;
      if (!series) return;

      let ps;
      try {
        ps = targetPane.priceScale('right');
      } catch {
        return;
      }

      const axisW = ps.width();
      if (e.clientX < rect.right - axisW - 1) return;
      
      e.preventDefault();
      e.stopPropagation();

      const paneH = targetPane.getHeight();
      if (paneH <= 0) return;
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
      const frac = Math.min(1, Math.max(0, (paneLocalY - dataTopY) / (dataBotY - dataTopY)));
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
      isPointerDownRef.current = true;
      if (lastCrosshairRef.current) {
        setTooltipPos({
          x: lastCrosshairRef.current.point.x,
          y: lastCrosshairRef.current.point.y,
          time: lastCrosshairRef.current.time,
          hover: lastCrosshairRef.current.payload
        });
      }
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

      const mainPaneSize = c.paneSize();
      if (localY > mainPaneSize.height) {
        // User clicked inside a lower pane (e.g. an oscillator).
        // Let Lightweight Charts handle default drag behaviors (like X-axis pan)
        return;
      }

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
      isPointerDownRef.current = false;
      setTooltipPos(null);
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
      // Precise hit first (same test pointerdown uses); the proximity
      // scan below is the fallback for near-misses.
      const hit = prim.customHitTest(localX, localY);
      let nextState: { kind: OverlayKind; price: number; y: number } | null = null;
      if (hit) {
        const price = series.coordinateToPrice(localY);
        if (price != null && Number.isFinite(price)) {
          nextState = { kind: hit.kind, price: price as number, y: localY };
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
        if (best) {
          nextState = { kind: best.kind, price: best.price, y: best.y };
        }
      }

      setHoverLine(prev => {
        if (prev === null && nextState === null) return prev;
        if (prev !== null && nextState !== null && prev.kind === nextState.kind && prev.price === nextState.price && prev.y === nextState.y) return prev;
        return nextState;
      });
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

    onReady?.({
      fitContent: () => chartRef.current?.timeScale().fitContent(),
      timeToX: (t) => {
        const c = chartRef.current;
        if (!c) return null;
        const x = c.timeScale().timeToCoordinate(t as Time);
        return x == null ? null : x;
      },
      priceToY: (p) => {
        const s = candleSeriesRef.current;
        if (!s) return null;
        const y = s.priceToCoordinate(p);
        return y == null ? null : y;
      },
      xToTime: (x) => {
        const c = chartRef.current;
        if (!c) return null;
        const t = c.timeScale().coordinateToTime(x);
        return t == null ? null : (t as number);
      },
      yToPrice: (y) => {
        const s = candleSeriesRef.current;
        if (!s) return null;
        const p = s.coordinateToPrice(y);
        return p == null ? null : p;
      },
      candleAtX: (x) => {
        const c = chartRef.current;
        if (!c) return null;
        const lg = c.timeScale().coordinateToLogical(x);
        if (lg == null) return null;
        return hoverInputsRef.current.base[Math.round(lg)] ?? null;
      },
      logicalAt: (x) => {
        const c = chartRef.current;
        if (!c) return null;
        const lg = c.timeScale().coordinateToLogical(x);
        return lg == null ? null : Math.round(lg);
      },
      subscribe: (cb) => {
        const c = chartRef.current;
        if (!c) return () => {};
        c.timeScale().subscribeVisibleLogicalRangeChange(cb);
        return () => c.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      },
      setVisibleLogicalRange: (range) => {
        chartRef.current?.timeScale().setVisibleLogicalRange(range);
      },
      getVisibleLogicalRange: () => {
        return chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
      },
      setCrosshairTime: (t) => {
        const c = chartRef.current;
        const s = candleSeriesRef.current;
        if (c && s) {
          if (t === null) {
            c.clearCrosshairPosition();
          } else {
            // Lightweight charts does not provide a direct way to set crosshair by time alone
            // without a price, but we can fake it or just let the global hover state sync the labels.
            // setCrosshairPosition actually takes (price, time, series). To just sync the vertical line,
            // we have to know the price or just clear it. Since sync is mainly visual, we will
            // rely on the global hover state for now.
            // (Placeholder implementation if we need it)
          }
        }
      },
      subscribeLogicalRange: (cb) => {
        const c = chartRef.current;
        if (!c) return () => {};
        c.timeScale().subscribeVisibleLogicalRangeChange(cb);
        return () => c.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      },
      subscribeCrosshairTime: (cb) => {
        const c = chartRef.current;
        if (!c) return () => {};
        const handler = (param: MouseEventParams) => cb(param.time as number ?? null);
        c.subscribeCrosshairMove(handler);
        return () => c.unsubscribeCrosshairMove(handler);
      },
    });

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
      // Theme signature: 'direction' colors the tag by the live candle
      // (TradingView convention); the Bitcoin theme pins it to gold with
      // dark ink — the reference design's axis tag.
      const P = paletteRef.current;
      cardEl.style.backgroundColor =
        P.priceCardBg === 'direction'
          ? isGreen
            ? P.bullFace
            : P.bearFace
          : P.priceCardBg;
      cardEl.style.color = P.priceCardInk;
      cdEl.style.color = P.priceCardSubInk;
      priceEl.textContent = priceVal.toFixed(1);
      
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
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange); } catch {}
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
      overlayPrimitiveRef.current = null;
      if (daySepRafRef.current) cancelAnimationFrame(daySepRafRef.current);
      fxPrimitiveRef.current = null;
      indicatorSeriesRef.current.clear();
      indicatorPanesRef.current.clear();
      priceLinesRef.current.clear();
      indicatorGradientRef.current.clear();
      indicatorMarkersRef.current.clear();
      indicatorSigRef.current = '';
      lastBarTimeRef.current = null;
      firstBarTimeRef.current = null;
      hoverInputsRef.current = { src: [], base: [], isRenko: false };
      initialZoomDoneRef.current = false;
      setHover(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReady]);

  // ---- Theme re-skin (extracted) ----
  useChartTheme(chartRef, candleSeriesRef, paletteRef, palette);

  const isRenko = type === 'renko';

  // ---- Price-scale mode + alert price lines + renko time-scale (extracted) ----
  usePriceScaleLines(chartRef, candleSeriesRef, priceLinesRef, isRenko, priceScaleMode, priceLines);

  // Track whether the active indicator has a separate-pane plot. Only
  // flips when the indicator changes (or the plots themselves) so
  // the data-push effect doesn't trigger a re-render every WS tick.
  useEffect(() => {
    const next = visibleResults.some((r) => r.result.plots.some((p) => p.pane === 'separate'));
    setHasSeparatePane((prev) => (prev === next ? prev : next));
  }, [visibleResults]);

  // ---- Shared refs bag (assembled once; all refs + setters are stable) ----
  const refsBagRef = useRef<ChartRefs | null>(null);
  if (!refsBagRef.current) {
    refsBagRef.current = {
      containerRef, priceCardRef, priceTextRef, countdownTextRef,
      chartRef, candleSeriesRef, dummySeriesRef, markersRef,
      overlayPrimitiveRef, fxPrimitiveRef, daySepCanvasRef, daySepRafRef,
      separatePaneRef,
      indicatorSeriesRef, indicatorPanesRef, indicatorSigRef,
      indicatorGradientRef, indicatorMarkersRef, priceLinesRef,
      paletteRef,
      hoverInputsRef, lastBarTimeRef, firstBarTimeRef,
      prevTypeRef, prevTfRef, prevOpenRef, prevCloseRef, lastCandleTimeRef,
      initialZoomDoneRef,
      onOverlayDragRef, onOverlayChipClickRef, onChartContextMenuRef, onLoadOlderRef,
      setHover, setHoverLine, setTooltipPos, setIsScrolledBack,
    };
  }
  const refs = refsBagRef.current;

  // ---- Data push + indicator stack (extracted) ----
  useChartData(refs, candles, type, tf, isRenko, visibleResults, indicatorSettingsMap, hiddenKeys, applyDefaultView);

  // ---- FX: bear hatching + pulse (extracted) ----
  useChartFx(fxPrimitiveRef, candleSeriesRef, chartRef, prevCloseRef, candles, type, renko);

  // ---- Signal markers (extracted) ----
  useSignalMarkers(markersRef, candles, showSignals, isRenko, visibleResults, palette);

  // ---- Order overlays sync (extracted) ----
  useOrderOverlays(
    overlayPrimitiveRef,
    overlays,
    overlaySide,
    overlayUnitsLabel,
    overlayTypeLabel,
    overlayHasTp,
    overlayHasSl,
    overlayTpPrice,
    overlaySlPrice,
    overlayEntryPrice,
    overlayPnL,
  );

  // ---- Reset Chart View ----
  useEffect(() => {
    if (!resetTick || !chartRef.current) return;
    applyDefaultView();
  }, [resetTick, applyDefaultView]);

  // ---- Day Separator Lines (extracted) ----
  useDaySeparators(
    chartRef,
    daySepCanvasRef,
    containerRef,
    hoverInputsRef,
    paletteRef,
    daySepRafRef,
    candles,
    tf,
    isRenko,
    palette,
  );

  // ---- Render ----
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: palette.chartBg }}>
      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
      />
      {/* Day separator canvas — sits above the chart but below crosshair/overlays */}
      <canvas
        ref={daySepCanvasRef}
        className="pointer-events-none absolute left-0 top-0 z-[2]"
        width={1}
        height={1}
      />
      <div
        ref={priceCardRef}
        className="pointer-events-none absolute right-0 z-[50] hidden flex-col items-stretch text-center font-mono tabular-nums tracking-tight text-white transition-colors duration-100"
        style={{ transform: 'translateY(-50%)' }}
      >
        <div ref={priceTextRef} className="py-[3px] text-[13px] font-semibold leading-none shadow-sm" />
        <div ref={countdownTextRef} className="pb-[4px] text-[12px] leading-none text-white/80" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: `radial-gradient(120% 90% at 50% 50%, transparent 55%, ${palette.vignette} 100%)`,
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

      {/* Crosshair OHLC tooltip — follows the cursor; reads the hover
          store internally, so it renders nothing between candles. */}
      {tooltipPos && <FloatingChartTooltip pos={tooltipPos} mode={type} />}

      <ChartFloatingControls
        type={type}
        onQuickTrade={onQuickTrade}
        onOpenRenkoSettings={onOpenRenkoSettings}
        bid={bid}
        ask={ask}
        priceScaleMode={priceScaleMode}
        onPriceScaleModeChange={onPriceScaleModeChange}
        isScrolledBack={isScrolledBack}
        onScrollToRealtime={() => {
          chartRef.current?.timeScale().scrollToRealTime();
          setIsScrolledBack(false);
        }}
      />

      <ChartLegend
        legendKeys={activeIndicatorIds ?? renderResults.map((r) => r.key)}
        renderResults={renderResults}
        indicatorSettingsMap={indicatorSettingsMap}
        hiddenKeys={hiddenKeys}
        settingsForKey={settingsForKey}
        isLegendExpanded={isLegendExpanded}
        onToggleHidden={(key) =>
          setHiddenKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onOpenSettings={setSettingsForKey}
        onRemove={(key) => {
          setSettingsForKey((k) => (k === key ? null : k));
          (onRemoveIndicator ?? onIndicatorChange)?.(key);
        }}
        onToggleExpand={() => setIsLegendExpanded((v) => !v)}
        onCloseSettings={() => setSettingsForKey(null)}
        onSaveSettings={(key, settings) => {
          if (onUpdateIndicatorSettingsFor) onUpdateIndicatorSettingsFor(key, settings);
          else onUpdateIndicatorSettings?.(settings);
        }}
      />
    </div>
  );
}
