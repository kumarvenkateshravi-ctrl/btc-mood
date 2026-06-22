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
  type LogicalRange,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type WhitespaceData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { toHeikinAshi } from '@/lib/heikinAshi';
import { toRenko, type RenkoOptions } from '@/lib/renko';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import { ema } from '@/lib/indicators';
import { buildSignalFlips } from '@/lib/signalMarkers';
import { setHover, type HoverPayload } from '@/lib/chartHoverStore';
import { OrderOverlayPrimitive } from '@/lib/orderOverlayPrimitive';
import { ChartFxPrimitive, type FxBarRect } from '@/lib/chartFxPrimitive';
import { IndicatorFillPrimitive } from '@/lib/indicatorFillPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import IndicatorSettingsModal from './trade/IndicatorSettingsModal';
import type { IndicatorSettings } from '@/lib/indicatorFramework';

function TvSettingsIcon({ size = 16, strokeWidth = 1.5, className = '' }: { size?: number, strokeWidth?: number, className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7.5 3h9l4.5 9-4.5 9h-9L3 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function shiftTime(t: number): Time {
  const tzOffset = new Date().getTimezoneOffset() * 60;
  return (t - tzOffset) as Time;
}
import type { Candle } from '@/lib/types';
import type { IndicatorResult, IndicatorPlot } from '@/lib/indicatorFramework';

export type ChartType = 'candlestick' | 'heikinAshi' | 'renko';

export type PriceScaleModeOption = 'normal' | 'log' | 'percent';

/** Coordinate + lifecycle API exposed via onReady, used by the drawing layer. */
export interface ChartApi {
  fitContent: () => void;
  /** chart-time → x pixel (null if off-scale). */
  timeToX: (time: number) => number | null;
  /** price → y pixel. */
  priceToY: (price: number) => number | null;
  /** x pixel → chart-time. */
  xToTime: (x: number) => number | null;
  /** y pixel → price. */
  yToPrice: (y: number) => number | null;
  /** The base candle nearest an x pixel (for magnet snapping to OHLC). */
  candleAtX: (x: number) => Candle | null;
  /** Rounded logical (candle) index at an x pixel — for the replay cut point. */
  logicalAt: (x: number) => number | null;
  /** Fires on horizontal pan/zoom; returns an unsubscribe fn. */
  subscribe: (cb: () => void) => () => void;
}

/** One entry in the indicator stack: a stable instance key + its computed result. */
export interface IndicatorRender {
  key: string;
  result: IndicatorResult;
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
  /** Primary indicator — still drives the legend + settings modal. */
  indicatorResult?: IndicatorResult | null;
  /** Full indicator stack to render. Falls back to [indicatorResult] when omitted. */
  indicatorResults?: IndicatorRender[];
  /** Right price-scale mode: linear / logarithmic / percentage. */
  priceScaleMode?: PriceScaleModeOption;
  showSignals?: boolean;
  /** Renko box-size configuration (method + params). */
  renko?: RenkoOptions;
  /** Horizontal price lines (e.g. price alerts) drawn on the candle series. */
  priceLines?: { id: string; price: number; color: string; title: string }[];
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
  onReady?: (api: ChartApi) => void;
  /** Fired when the user scrolls near the left edge — lazy-load older history. */
  onLoadOlder?: () => void;
  regime?: number;
  overlayPnL?: number | null;
  onChartContextMenu?: (price: number, x: number, y: number) => void;
  showVolume?: boolean;
  onToggleVolume?: () => void;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  bid?: number | null;
  ask?: number | null;
  activeIndicatorId: string;
  onIndicatorChange: (id: string) => void;
  indicatorSettings?: IndicatorSettings;
  onUpdateIndicatorSettings?: (settings: IndicatorSettings) => void;
  /** All active indicator ids (keys) — for the per-instance legend. */
  activeIndicatorIds?: string[];
  /** Per-indicator settings, keyed by id — for the per-instance legend/modal. */
  indicatorSettingsMap?: Record<string, IndicatorSettings>;
  /** Remove a single indicator by id (legend ✕). */
  onRemoveIndicator?: (id: string) => void;
  /** Save settings for a specific indicator id (legend gear). */
  onUpdateIndicatorSettingsFor?: (id: string, settings: IndicatorSettings) => void;
}

export default function Chart({
  candles,
  type,
  tf,
  height,
  indicatorResult = null,
  indicatorResults,
  priceScaleMode = 'normal',
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
  regime = 0.2,
  overlayPnL = null,
  onChartContextMenu,
  showVolume = true,
  onToggleVolume,
  onQuickTrade,
  bid = null,
  ask = null,
  activeIndicatorId,
  onIndicatorChange,
  indicatorSettings,
  onUpdateIndicatorSettings,
  activeIndicatorIds,
  indicatorSettingsMap,
  onRemoveIndicator,
  onUpdateIndicatorSettingsFor,
}: ChartProps) {
  // Per-instance legend: which indicator's settings modal is open, and which
  // indicators are hidden (eye toggled off).
  const [settingsForKey, setSettingsForKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // Normalize the single + stack props into one render list. Effects below
  // iterate this so one or many indicators render through the same path.
  const renderResults = useMemo<IndicatorRender[]>(() => {
    if (indicatorResults) return indicatorResults;
    if (indicatorResult) return [{ key: activeIndicatorId || 'main', result: indicatorResult }];
    return [];
  }, [indicatorResults, indicatorResult, activeIndicatorId]);

  // Indicators with their eye toggled off are dropped from rendering entirely.
  const visibleResults = useMemo<IndicatorRender[]>(
    () => renderResults.filter((r) => !hiddenKeys.has(r.key)),
    [renderResults, hiddenKeys],
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
      if (!st) return;
      try {
        series.applyOptions({
          color: st.color || undefined,
          lineWidth: (st.thickness as 1 | 2 | 3 | 4) || undefined,
          visible: st.display !== false,
        });
      } catch {}
    });
  }, [indicatorSettingsMap, visibleResults]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const priceCardRef = useRef<HTMLDivElement | null>(null);
  const priceTextRef = useRef<HTMLDivElement | null>(null);
  const countdownTextRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
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
  const [hasSeparatePane, setHasSeparatePane] = useState(false);
  const fxPrimitiveRef = useRef<ChartFxPrimitive | null>(null);

  const [hover, setHoverLine] = useState<{
    kind: OverlayKind;
    price: number;
    y: number;
  } | null>(null);

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
      height: containerRef.current.clientHeight || height,
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
      };
      setHover(payload);
    };
    chart.subscribeCrosshairMove(onCrosshair);

    // Lazy-load older history when the user scrolls near the left edge.
    const onLogicalRange = (range: LogicalRange | null) => {
      if (range && range.from < 10) onLoadOlderRef.current?.();
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
        const ts = c.timeScale();
        ts.subscribeVisibleLogicalRangeChange(cb);
        return () => {
          try { ts.unsubscribeVisibleLogicalRangeChange(cb); } catch {}
        };
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
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange); } catch {}
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
      overlayPrimitiveRef.current = null;
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

  const isRenko = type === 'renko';

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      timeVisible: !isRenko,
      secondsVisible: false,
    });
  }, [isRenko]);

  // Right price-scale mode (linear / log / percentage).
  useEffect(() => {
    const mode =
      priceScaleMode === 'log'
        ? PriceScaleMode.Logarithmic
        : priceScaleMode === 'percent'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    try {
      chartRef.current?.priceScale('right').applyOptions({ mode });
    } catch {}
  }, [priceScaleMode]);

  // Horizontal price lines (price alerts) on the candle series.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const existing = priceLinesRef.current;
    const lines = priceLines ?? [];
    const wanted = new Set(lines.map((l) => l.id));
    for (const [id, line] of existing) {
      if (!wanted.has(id)) {
        try { series.removePriceLine(line); } catch {}
        existing.delete(id);
      }
    }
    for (const l of lines) {
      const cur = existing.get(l.id);
      if (cur) {
        try { cur.applyOptions({ price: l.price, color: l.color, title: l.title }); } catch {}
      } else {
        try {
          existing.set(
            l.id,
            series.createPriceLine({
              price: l.price,
              color: l.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: l.title,
            }),
          );
        } catch {}
      }
    }
  }, [priceLines]);

  // Track whether the active indicator has a separate-pane plot. Only
  // flips when the indicator changes (or the plots themselves) so
  // the data-push effect doesn't trigger a re-render every WS tick.
  useEffect(() => {
    const next = visibleResults.some((r) => r.result.plots.some((p) => p.pane === 'separate'));
    setHasSeparatePane((prev) => (prev === next ? prev : next));
  }, [visibleResults]);

  // ---- Data push ----
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

    const baseCandles =
      type === 'heikinAshi'
        ? toHeikinAshi(candles)
        : type === 'renko'
        ? toRenko(candles, renko ?? {})
        : candles;
    const closes = candles.map((c) => c.close);
    hoverInputsRef.current = { src: candles, base: baseCandles, isRenko };

    if (baseCandles.length === 0) return;

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
      const lastSrc = candles[candles.length - 1];
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
        .map((r) => `${r.key}#${r.result.plots.map((p) => `${p.id}:${p.type}:${p.pane ?? 'overlay'}`).join(',')}`)
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
            const visible = st?.display !== false;
            let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | undefined;
            if (plot.type === 'histogram') {
              series = chart.addSeries(
                HistogramSeries,
                { color, visible, priceLineVisible: false, lastValueVisible: false, title: plot.title },
                targetPane,
              );
            } else {
              // 'line' (and, for now, 'band') render as a line series.
              series = chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth,
                  visible,
                  priceLineVisible: false,
                  lastValueVisible: false,
                  crosshairMarkerVisible: false,
                  title: plot.title,
                },
                targetPane,
              );
            }
            if (series) existing.set(`${key}::${plot.id}`, series);
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
                  axisLabelVisible: true,
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
              series.setData(formatted as any[]);
            } catch (err) {
              console.error(`Failed to set indicator data for ${key}::${plot.id}:`, err);
            }
          }
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
      const timeScale = chartRef.current.timeScale();
      const toIndex = baseCandles.length - 1 + 10; // Force exact 10 bar gap
      const barsOnScreen = timeScale.width() / 14; // Default barSpacing is 14
      timeScale.setVisibleLogicalRange({
        from: toIndex - barsOnScreen,
        to: toIndex,
      });
    }
  }, [candles, type, renko, isRenko, tf, visibleResults]);

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
        ? toRenko(candles, renko ?? {})
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
      const x = c.timeScale().timeToCoordinate(shiftTime(b.time as number));
      if (top == null || bot == null || x == null) continue;
      rects.push({
        time: shiftTime(b.time as number),
        x,
        w: 7,
        y: top,
        h: bot - top,
      });
    }
    fx.setOptions({ bars: rects, latestIndex: rects.length - 1 });
  }, [candles, type, renko]);

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
    if (!showSignals || isRenko || candles.length === 0 || visibleResults.length === 0) {
      mk.setMarkers([]);
      return;
    }

    // Merge signals across the whole stack, then sort by time —
    // setMarkers requires ascending order.
    const markers: SeriesMarker<Time>[] = [];
    for (const { result } of visibleResults) {
      for (let i = 0; i < result.signals.length; i++) {
        const sig = result.signals[i];
        if (!candles[i]) continue;
        if (sig === 'buy') {
          markers.push({
            time: shiftTime(candles[i].time as number),
            position: 'belowBar',
            color: '#22d39a',
            shape: 'arrowUp',
            text: 'BUY',
          });
        } else if (sig === 'sell') {
          markers.push({
            time: shiftTime(candles[i].time as number),
            position: 'aboveBar',
            color: '#fb5168',
            shape: 'arrowDown',
            text: 'SELL',
          });
        }
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [candles, showSignals, isRenko, visibleResults]);

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
    <div className="relative h-full w-full overflow-hidden" style={{ background: C.chartBg }}>
      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
      />
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

      {(() => {
        const legendKeys = activeIndicatorIds ?? renderResults.map((r) => r.key);
        if (legendKeys.length === 0) return null;
        const resultByKey = new Map(renderResults.map((r) => [r.key, r.result] as const));

        return (
          <div className="pointer-events-none absolute left-2 top-16 z-10 flex flex-col gap-0.5">
            {legendKeys.map((key) => {
              const def = CUSTOM_INDICATORS.find((d) => d.id === key);
              if (!def) return null;
              const result = resultByKey.get(key);
              const settings = indicatorSettingsMap?.[key];
              const hidden = hiddenKeys.has(key);
              const isOpen = settingsForKey === key;

              const inputs = settings?.inputs ?? {};
              const paramText = (def.inputs ?? [])
                .filter((inp) => inp.type === 'number')
                .map((inp) => inputs[inp.id] ?? inp.default)
                .slice(0, 4)
                .join(' ');

              let latestValue: number | null = null;
              let valueColor = '#2962FF';
              const plot = result?.plots?.[0];
              if (plot && plot.data.length) {
                const last = plot.data[plot.data.length - 1];
                if (typeof last === 'number') latestValue = last;
                else if (last && typeof last === 'object' && 'value' in last) latestValue = last.value;
                valueColor = settings?.styles?.[plot.id]?.color || plot.color || valueColor;
              }
              const displayValue =
                latestValue != null
                  ? Number(latestValue).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })
                  : '';

              return (
                <div
                  key={key}
                  className={`pointer-events-auto group flex cursor-default items-center gap-2 rounded px-2 py-0.5 transition-colors ${isOpen ? 'bg-white/[0.08]' : 'bg-transparent hover:bg-white/[0.04]'}`}
                >
                  <div className={`flex items-baseline gap-1.5 text-[13px] transition-opacity duration-200 ${hidden ? 'opacity-40' : 'opacity-100'}`}>
                    <span className={isOpen ? 'text-[#2962FF]' : 'text-[#d1d4dc]'}>{def.name}</span>
                    {paramText && <span className="text-[#787b86]">{paramText}</span>}
                    {displayValue && <span style={{ color: valueColor }}>{displayValue}</span>}
                  </div>
                  <div className={`flex items-center transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button
                      className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                      title={hidden ? 'Show' : 'Hide'}
                      onClick={() =>
                        setHiddenKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    >
                      {hidden ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
                    </button>
                    <button
                      className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                      title="Settings"
                      onClick={() => setSettingsForKey(key)}
                    >
                      <TvSettingsIcon size={18} strokeWidth={1.5} />
                    </button>
                    <button
                      className="rounded p-1 text-ink/50 transition hover:bg-ink/10 hover:text-ink"
                      title="Remove"
                      onClick={() => {
                        setSettingsForKey((k) => (k === key ? null : k));
                        (onRemoveIndicator ?? onIndicatorChange)?.(key);
                      }}
                    >
                      <Trash2 size={18} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {settingsForKey && CUSTOM_INDICATORS.find((d) => d.id === settingsForKey) && (
        <IndicatorSettingsModal
          indicatorDef={CUSTOM_INDICATORS.find((d) => d.id === settingsForKey)!}
          initialSettings={indicatorSettingsMap?.[settingsForKey]}
          onClose={() => setSettingsForKey(null)}
          onSave={(settings) => {
            if (onUpdateIndicatorSettingsFor) onUpdateIndicatorSettingsFor(settingsForKey, settings);
            else onUpdateIndicatorSettings?.(settings);
          }}
        />
      )}
    </div>
  );
}

// ---- Helper components ----



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
