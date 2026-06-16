'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart, { type ChartIndicators, type ChartType } from './Chart';
import ChartToolbar from './ChartToolbar';
import OHLCLegend from './OHLCLegend';
import { computeChartHeight, isMobileViewport, FALLBACK_HEIGHT } from '@/lib/chartHeight';
import { ema } from '@/lib/indicators';
import { INDICATORS } from '@/lib/indicatorLibrary';
import { computeIndicator, type ComputedIndicator } from '@/lib/indicatorCompute';
import type { Candle, Timeframe } from '@/lib/types';
import { useSharedIndicators } from '@/lib/useSharedIndicators';

interface ChartPanelProps {
  candles: Candle[];
  type: ChartType;
  onTypeChange: (t: ChartType) => void;
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  symbol: string;
  price: number | null;
  change: number | null;
  status: 'live' | 'demo' | 'loading';
  /** Casual view hides the EMA overlays and their controls. */
  hideIndicators?: boolean;
  showVolume?: boolean;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  bid?: number | null;
  ask?: number | null;
}

const NO_INDICATORS: ChartIndicators = { ema9: false, ema21: false };

export default function ChartPanel({
  candles,
  type,
  onTypeChange,
  selected,
  onSelectTf,
  symbol,
  price,
  change,
  status,
  hideIndicators = false,
  showVolume: parentShowVolume,
  onQuickTrade,
  bid = null,
  ask = null,
}: ChartPanelProps) {
  const [indicators, setIndicators] = useState<ChartIndicators>({
    ema9: true,
    ema21: true,
  });

  // EMA periods are now editable from the legend's gear icon — defaults
  // match the original hardcoded 9 / 21.
  const [emaFastPeriod, setEmaFastPeriod] = useState(9);
  const [emaSlowPeriod, setEmaSlowPeriod] = useState(21);

  const effectiveIndicators = hideIndicators ? NO_INDICATORS : indicators;

  // BUY/SELL signal markers on the chart, on by default.
  const [showSignals, setShowSignals] = useState(true);
  const toggleSignals = useCallback(() => setShowSignals((v) => !v), []);

  const handleEmaPeriod = useCallback((key: 'ema9' | 'ema21', period: number) => {
    if (!Number.isFinite(period) || period < 2 || period > 500) return;
    if (key === 'ema9') setEmaFastPeriod(period);
    else setEmaSlowPeriod(period);
  }, []);

  // Shared indicators (synced with Trade page via localStorage)
  const {
    activeIndicators,
    handleAdd: handleAddIndicator,
    handleRemove: handleRemoveIndicator,
    handleToggle: handleToggleIndicator,
    handleParam: handleParamChange,
    handleColor: handleIndicatorColor,
  } = useSharedIndicators();

  const lookup = useMemo(() => new Map(INDICATORS.map((d) => [d.id, d])), []);

  const computedIndicators = useMemo<ComputedIndicator[]>(() => {
    if (candles.length === 0) return [];
    return activeIndicators
      .filter((a) => a.visible)
      .map((a) => {
        const def = lookup.get(a.id);
        if (!def) return null;
        const computed = computeIndicator(def, candles, a.params);
        if (a.color && computed.lines.length > 0) {
          computed.lines[0].color = a.color;
        }
        return computed;
      })
      .filter(Boolean) as ComputedIndicator[];
  }, [candles, activeIndicators, lookup]);

  // Renko brick state.
  const [brickSize, setBrickSize] = useState<number | null>(null);
  const [autoBrick, setAutoBrick] = useState(true);

  const sectionRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartHeight, setChartHeight] = useState(FALLBACK_HEIGHT);
  const [compact, setCompact] = useState(false);
  const chartApiRef = useRef<{ fitContent: () => void } | null>(null);

  useEffect(() => {
    setChartHeight(computeChartHeight());
    setCompact(isMobileViewport());
    const onResize = () => {
      setChartHeight(computeChartHeight());
      setCompact(isMobileViewport());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Track fullscreen state via the Fullscreen API so the toolbar icon
  // and `Esc` handler can stay in sync.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Keyboard: `F` toggles fullscreen on this section, `Esc` exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
        e.preventDefault();
      } else if (e.key === 'Escape' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  const toggleIndicator = useCallback((key: 'ema9' | 'ema21') => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Live EMA values for the indicator pills. Recomputed when candles
  // or the underlying closes change. Tracks the current editable period
  // so a gear-icon period change reflects in the displayed value too.
  const { lastEma9, lastEma21 } = useMemo(() => {
    const min = Math.max(emaFastPeriod, emaSlowPeriod) + 1;
    if (candles.length < min) return { lastEma9: null, lastEma21: null };
    const closes = candles.map((c) => c.close);
    const f = ema(closes, emaFastPeriod);
    const s = ema(closes, emaSlowPeriod);
    return {
      lastEma9: f[f.length - 1] ?? null,
      lastEma21: s[s.length - 1] ?? null,
    };
  }, [candles, emaFastPeriod, emaSlowPeriod]);

  const handleChartReady = useCallback(
    (api: { fitContent: () => void }) => {
      chartApiRef.current = api;
    },
    [],
  );

  const fitContent = useCallback(() => {
    chartApiRef.current?.fitContent();
  }, []);

  const loading = candles.length === 0;

  return (
    <section
      ref={sectionRef}
      className="panel overflow-hidden rounded-2xl"
    >
      <ChartToolbar
        symbol={symbol}
        price={price}
        change={change}
        status={status}
        selected={selected}
        onSelectTf={onSelectTf}
        chartType={type}
        onSelectType={onTypeChange}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        hideIndicators={hideIndicators}
        showSignals={showSignals}
        onToggleSignals={toggleSignals}
        lastEma9={lastEma9}
        lastEma21={lastEma21}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onFitContent={fitContent}
        brickSize={brickSize}
        autoBrick={autoBrick}
        onBrickSizeChange={setBrickSize}
        onAutoBrickChange={setAutoBrick}
        activeIndicators={activeIndicators}
        onAddIndicator={handleAddIndicator}
        onToggleIndicatorFull={handleToggleIndicator}
      />
      <OHLCLegend compact={compact} mode={type} />
      <div className="relative" style={{ height: chartHeight }}>
        {loading && <ChartSkeleton height={chartHeight} />}
        {!loading && (
          <Chart
            candles={candles}
            type={type}
            height={chartHeight}
            indicators={effectiveIndicators}
            showSignals={showSignals}
            brickSize={brickSize ?? undefined}
            autoBrick={autoBrick}
            onReady={handleChartReady}
            customIndicators={computedIndicators}
            tf={selected}
            activeIndicators={activeIndicators}
            emaFastPeriod={emaFastPeriod}
            emaSlowPeriod={emaSlowPeriod}
            onEmaToggle={toggleIndicator}
            onEmaPeriod={handleEmaPeriod}
            showVolume={parentShowVolume}
            onQuickTrade={onQuickTrade}
            bid={bid}
            ask={ask}
          />
        )}
      </div>
    </section>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      role="status"
      aria-label="Loading chart"
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-chart-bg"
    >
      <div
        className="h-full w-full"
        style={{
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, oklch(0.30 0.03 264 / 0.5) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s linear infinite',
        }}
      />
      <span className="sr-only">Loading chart…</span>
    </div>
  );
}
