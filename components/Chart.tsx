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
import { OrderControlsRow } from './chart/OrderControlsRow';
import { getChartPalette, useThemeName, type ChartPalette } from '@/lib/chartTheme';

import { ChartFxPrimitive, type FxBarRect } from '@/lib/chartFxPrimitive';
import { IndicatorFillPrimitive } from '@/lib/indicatorFillPrimitive';
import { GradientZonePrimitive } from '@/lib/gradientZonePrimitive';
import { PriceLinesPrimitive } from '@/lib/priceLinesPrimitive';
import type { Candle, Timeframe } from '@/lib/types';
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
import { SignalExplainer } from '@/components/SignalExplainer';
import { DivergenceExplainer } from '@/components/DivergenceExplainer';
import { buildSignalFlips } from '@/lib/signalMarkers';
import { buildDivergenceMarkers } from '@/lib/divergenceMarkers';
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
import { useChartInit } from './chart/useChartInit';
import { useChartEvents } from './chart/useChartEvents';
import { useCountdownTimer } from './chart/useCountdownTimer';
import { useChartApi } from './chart/useChartApi';

export type { ChartType, PriceScaleModeOption, ChartApi, ChartOverlay, OverlayKind, IndicatorRender } from './chart/types';

// Stable empty result so effects depending on divergence markers don't
// retrigger when there's no multi-TF data.
const EMPTY_DIV_MARKERS: ReturnType<typeof buildDivergenceMarkers> = { markers: [], payloads: [] };

export default function Chart({
  candles,
  candlesByTf,
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
  onPriceLineDrag,
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
  overlayBadges,
  stagedOrder = null,
  onStageReverse,
  onStageDiscard,
  onStageConfirm,
  onStageToggleTp,
  onStageToggleSl,
  positionControls = null,
  onPositionToggleTp,
  onPositionToggleSl,
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
  const indicatorGradientRef = useRef<Map<string, GradientZonePrimitive>>(new Map());
  const indicatorMarkersRef = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map());
  const priceLinesPrimitiveRef = useRef<PriceLinesPrimitive | null>(null);
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
  const onPriceLineDragRef = useRef<typeof onPriceLineDrag>(onPriceLineDrag);
  useEffect(() => {
    onOverlayDragRef.current = onOverlayDrag;
    onOverlayChipClickRef.current = onOverlayChipClick;
    onChartContextMenuRef.current = onChartContextMenu;
    onLoadOlderRef.current = onLoadOlder;
    onPriceLineDragRef.current = onPriceLineDrag;
  }, [onOverlayDrag, onOverlayChipClick, onChartContextMenu, onLoadOlder, onPriceLineDrag]);

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
      indicatorGradientRef, indicatorMarkersRef, priceLinesPrimitiveRef,
      paletteRef,
      hoverInputsRef, lastBarTimeRef, firstBarTimeRef,
      prevTypeRef, prevTfRef, prevOpenRef, prevCloseRef, lastCandleTimeRef,
      initialZoomDoneRef,
      isPointerDownRef, lastCrosshairRef,
      onOverlayDragRef, onOverlayChipClickRef, onChartContextMenuRef, onLoadOlderRef, onPriceLineDragRef,
      setHover, setHoverLine, setTooltipPos, setIsScrolledBack,
    };
  }
  const refs = refsBagRef.current!;

  // ---- Chart Creation & Events (Extracted hooks) ----
  useChartInit(refs, height, tf);
  useChartEvents(refs);
  useCountdownTimer(refs, tf, palette);
  useChartApi(refs, onReady);

  // ---- Theme re-skin (extracted) ----
  useChartTheme(chartRef, candleSeriesRef, paletteRef, palette);

  // Memoize signal flips for the "Why this signal?" explainer
  const flips = useMemo(() => buildSignalFlips(candles), [candles]);

  const hasSignalsIndicator = useMemo(() => {
    // In multi-chart, visibleResults keys might be prefixed with tf, e.g. "5m:sma", so we check includes
    return visibleResults.some(r => r.key.includes('ma_ribbon_tv') || r.key.includes('crossover') || r.key.includes('sma') || r.key.includes('ema'));
  }, [visibleResults]);

  const hasDivergenceIndicator = useMemo(() => {
    return visibleResults.some(r => r.key.includes('rsi') || r.key.includes('macd'));
  }, [visibleResults]);

  const activeFlips = hasSignalsIndicator ? flips : [];

  // Divergence markers sweep every base bar across all timeframes — too heavy
  // to rerun on every in-bar tick. Cache keyed on bar identity (tf + count +
  // last bar's open time), so it only recomputes when a bar closes / history
  // lazy-loads, not when the live bar's close wiggles.
  const divCacheRef = useRef<{ key: string; data: ReturnType<typeof buildDivergenceMarkers> } | null>(null);
  const baseTfCandles = candlesByTf && tf ? candlesByTf[tf as Timeframe] : undefined;
  const divKey = baseTfCandles?.length
    ? `${tf}:${baseTfCandles.length}:${baseTfCandles[baseTfCandles.length - 1].time}`
    : '';
  if (!divKey) {
    divCacheRef.current = null;
  } else if (divCacheRef.current?.key !== divKey) {
    divCacheRef.current = {
      key: divKey,
      data: buildDivergenceMarkers(candlesByTf as Record<Timeframe, Candle[]>, tf as Timeframe),
    };
  }
  const divMarkersData = divCacheRef.current?.data ?? EMPTY_DIV_MARKERS;
  const isRenko = type === 'renko';

  // ---- Price-scale mode + alert price lines + renko time-scale (extracted) ----
  usePriceScaleLines(chartRef, candleSeriesRef, priceLinesPrimitiveRef, isRenko, priceScaleMode, priceLines);

  // ---- Data push + indicator stack (extracted) ----
  useChartData(refs, candles, type, tf, isRenko, visibleResults, indicatorSettingsMap, hiddenKeys, applyDefaultView);

  // ---- FX: bear hatching + pulse (extracted) ----
  useChartFx(fxPrimitiveRef, candleSeriesRef, chartRef, prevCloseRef, candles, type, renko);

  // ---- Signal markers (extracted) ----
  const activeDivMarkers = hasDivergenceIndicator ? divMarkersData.markers : [];
  useSignalMarkers(markersRef, candles, showSignals, isRenko, visibleResults, palette, activeFlips, activeDivMarkers);

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
    overlayBadges,
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
      {stagedOrder && (
        <OrderControlsRow
          mode="staged"
          chart={chartRef.current}
          series={candleSeriesRef.current}
          entryPrice={stagedOrder.entry}
          hasTp={stagedOrder.hasTp}
          hasSl={stagedOrder.hasSl}
          onReverse={onStageReverse!}
          onDiscard={onStageDiscard!}
          onConfirm={onStageConfirm!}
          onToggleTp={onStageToggleTp!}
          onToggleSl={onStageToggleSl!}
        />
      )}
      {!stagedOrder && positionControls && (!positionControls.hasTp || !positionControls.hasSl) && (
        <OrderControlsRow
          mode="position"
          chart={chartRef.current}
          series={candleSeriesRef.current}
          entryPrice={positionControls.entry}
          hasTp={positionControls.hasTp}
          hasSl={positionControls.hasSl}
          onToggleTp={onPositionToggleTp!}
          onToggleSl={onPositionToggleSl!}
        />
      )}

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
      {tooltipPos && <SignalExplainer pos={tooltipPos} flips={activeFlips} />}
      {tooltipPos && <DivergenceExplainer pos={tooltipPos} payloads={hasDivergenceIndicator ? divMarkersData.payloads : []} />}

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
