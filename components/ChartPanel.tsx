'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart, { type ChartType } from './Chart';
import ChartToolbar from './ChartToolbar';
import OHLCLegend from './OHLCLegend';
import { computeChartHeight, isMobileViewport, FALLBACK_HEIGHT } from '@/lib/chartHeight';
import type { Candle, Timeframe } from '@/lib/types';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { IndicatorSettings } from '@/lib/indicatorFramework';

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
  showVolume?: boolean;
  onQuickTrade?: (side: 'buy' | 'sell') => void;
  bid?: number | null;
  ask?: number | null;
  activeIndicatorId: string;
  onIndicatorChange: (id: string) => void;
}



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
  showVolume: parentShowVolume,
  onQuickTrade,
  bid = null,
  ask = null,
  activeIndicatorId,
  onIndicatorChange,
}: ChartPanelProps) {


  // BUY/SELL signal markers on the chart, on by default.
  const [showSignals, setShowSignals] = useState(true);
  const toggleSignals = useCallback(() => setShowSignals((v) => !v), []);



  // Renko brick state.
  const [brickSize, setBrickSize] = useState<number | null>(null);
  const [autoBrick, setAutoBrick] = useState(true);

  // Indicator settings
  const [indicatorSettings, setIndicatorSettings] = useState<Record<string, IndicatorSettings>>({});

  const handleUpdateIndicatorSettings = useCallback((id: string, settings: IndicatorSettings) => {
    setIndicatorSettings((prev) => ({ ...prev, [id]: settings }));
  }, []);

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

  const indicatorResult = useMemo(() => {
    if (loading) return null;
    const activeDef = CUSTOM_INDICATORS.find(d => d.id === activeIndicatorId);
    if (!activeDef) return null;
    return activeDef.compute(candles, { 
      id: activeDef.id, 
      settings: indicatorSettings[activeIndicatorId] 
    });
  }, [candles, loading, activeIndicatorId, indicatorSettings]);

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
        showSignals={showSignals}
        onToggleSignals={toggleSignals}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onFitContent={fitContent}
        brickSize={brickSize}
        autoBrick={autoBrick}
        onBrickSizeChange={setBrickSize}
        onAutoBrickChange={setAutoBrick}
        activeIndicatorId={activeIndicatorId}
        onIndicatorChange={onIndicatorChange}
      />
      <OHLCLegend compact={compact} mode={type} />
      <div className="relative" style={{ height: chartHeight }}>
        {loading && <ChartSkeleton height={chartHeight} />}
        {!loading && (
          <Chart
            candles={candles}
            type={type}
            height={chartHeight}
            indicatorResult={indicatorResult}
            showSignals={showSignals}
            brickSize={brickSize ?? undefined}
            autoBrick={autoBrick}
            onReady={handleChartReady}
            tf={selected}
            showVolume={parentShowVolume}
            onQuickTrade={onQuickTrade}
            bid={bid}
            ask={ask}
            activeIndicatorId={activeIndicatorId}
            onIndicatorChange={onIndicatorChange}
            indicatorSettings={indicatorSettings[activeIndicatorId]}
            onUpdateIndicatorSettings={(settings) => handleUpdateIndicatorSettings(activeIndicatorId, settings)}
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
