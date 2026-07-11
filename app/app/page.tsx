'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
// Charts are lazy-loaded (DESIGN.md §L budget). lightweight-charts (~3MB) is
// only imported through ChartPanel + MultiChartGrid; making BOTH dynamic keeps
// it out of /app's initial bundle until a chart actually renders. BottomDock is
// below the fold, so it's deferred too.
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
const MultiChartGrid = dynamic(() => import('@/components/MultiChartGrid'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-ink-faint">Loading charts…</div>,
});
const BottomDock = dynamic(() => import('@/components/BottomDock'), {
  ssr: false,
  loading: () => <div className="h-full bg-surface-1" />,
});
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from 'react-resizable-panels';
import SymbolSearch from '@/components/SymbolSearch';
import DashboardAside from '@/components/DashboardAside';
import MarketContextWidget from '@/components/MarketContextWidget';
import { useMarketContext } from '@/lib/hooks/useMarketContext';
import { useScannerEngine } from '@/lib/hooks/useScannerEngine';
import ScannerSignalsDock from '@/components/scanner/ScannerSignalsDock';
import TechnicalScannerPanel from '@/components/scanner/TechnicalScannerPanel';
import { computeSdSignalEvents } from '@/lib/indicators/sdSignals';
import MoodStrip from '@/components/MoodStrip';
import OrderFlowPanel from '@/components/OrderFlowPanel';
import RightDock, { type RightPanelId } from '@/components/RightDock';
import { useDrawings, getDrawings, setDrawings } from '@/lib/drawings';
import { useSharedIndicators } from '@/lib/useSharedIndicators';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import {
  DEFAULT_COMPARE_SYMBOL,
  isCompareSymbol,
  type CompareSymbol,
} from '@/lib/compare';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import type { WorkspaceConfig } from '@/lib/workspaces';
import {
  INDICATORS_KEY,
  readInitialState,
  writeUrlState,
} from '@/lib/dashboardUrl';
import { useMarketData } from '@/lib/hooks/useMarketData';
import { useMoodEngine } from '@/lib/hooks/useMoodEngine';
import { useHistoryWindow } from '@/lib/hooks/useHistoryWindow';
import { useAlerts } from '@/lib/hooks/useAlerts';
import { useGridState } from '@/lib/hooks/useGridState';
import { useReplayCut } from '@/lib/replay/replayCut';
import { sliceCandlesByTf } from '@/lib/replay/replaySlice';
import { useLayoutMigrationToast } from '@/components/useLayoutMigrationToast';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { useMarketState } from '@/lib/hooks/useMarketState';

export default function DashboardPage() {
  // ---- Core view state ----
  const [selected, setSelected] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [symbol, setSymbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [hydrated, setHydrated] = useState(false);
  const [activeIndicatorIds, setActiveIndicatorIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<'signals' | 'trade' | 'trades'>('signals');
  // Which right-rail panel is shown (null = collapsed). Driven by the far-right icon dock.
  const [rightPanel, setRightPanel] = useState<RightPanelId | null>('signals');

  const selectRightPanel = useCallback(
    (id: RightPanelId) => setRightPanel((p) => (p === id ? null : id)),
    [],
  );

  const toggleIndicator = useCallback((id: string) => {
    setActiveIndicatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);
  const clearIndicators = useCallback(() => setActiveIndicatorIds([]), []);

  const { gridCount, gridTfs, layout: gridLayout, setLayout: setGridLayout, handleGridCountChange, migrated: layoutMigrated, previousCount: layoutPreviousCount } = useGridState(selected);
  useLayoutMigrationToast({ migrated: layoutMigrated, previousCount: layoutPreviousCount });

  const applyWorkspace = useCallback((cfg: WorkspaceConfig) => {
    if (cfg.chartType === 'candlestick' || cfg.chartType === 'heikinAshi' || cfg.chartType === 'renko') {
      setChartType(cfg.chartType);
    }
    if (isCompareSymbol(cfg.symbol)) setSymbol(cfg.symbol);
    if ((TIMEFRAMES as string[]).includes(cfg.tf)) setSelected(cfg.tf as Timeframe);
    setActiveIndicatorIds(cfg.indicatorIds.filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id)));
  }, []);

  const { activeIndicators, showVolume, toggleVolume, handleAdd: handleAddIndicator, handleRemove: handleRemoveIndicator, handleToggle: handleToggleIndicator } = useSharedIndicators();

  const currentDrawings = useDrawings(symbol);

  // ---- Hydrate from URL + localStorage ----
  useEffect(() => {
    const init = readInitialState();
    setSymbol(init.symbol);
    setSelected(init.tf);
    setChartType(init.type);
    if (init.indicators && init.indicators.length) {
      setActiveIndicatorIds(init.indicators);
    } else {
      try {
        const raw = localStorage.getItem(INDICATORS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const valid = parsed.filter(
              (id) => typeof id === 'string' && CUSTOM_INDICATORS.some((d) => d.id === id),
            );
            if (valid.length) setActiveIndicatorIds(valid);
          }
        }
      } catch {}
    }
    try {
      const rp = localStorage.getItem('rightPanel');
      if (rp === 'mood' || rp === 'signals' || rp === 'orderflow' || rp === 'scanner') setRightPanel(rp);
      else if (rp === 'none') setRightPanel(null);
    } catch {}

    if (init.drawings && init.drawings.length > 0) {
      const existing = getDrawings(init.symbol);
      if (existing.length === 0) {
        setDrawings(init.symbol, init.drawings);
      }
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('rightPanel', rightPanel ?? 'none');
    } catch {}
  }, [hydrated, rightPanel]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(INDICATORS_KEY, JSON.stringify(activeIndicatorIds));
    } catch {}
  }, [hydrated, activeIndicatorIds]);

  useEffect(() => {
    if (!hydrated) return;
    writeUrlState(selected, chartType, symbol, activeIndicatorIds, currentDrawings);
  }, [hydrated, selected, chartType, symbol, activeIndicatorIds, currentDrawings]);

  // ---- Keyboard shortcuts ----
  useKeyboardShortcuts({
    onSearch: () => setSearchOpen(true),
    onSelectTf: setSelected,
    onChartType: setChartType,
    gridCount,
    onGridCycle: handleGridCountChange,
  });

  // ---- Market data pipeline ----
  const { candlesByTf, status, bookTicker, ticker24h, loadOlder, wsStatus, lastUpdateMs } =
    useMarketData(symbol);

  const dataState = useMarketState({ wsStatus, lastUpdateMs, hasData: true });

  // ---- Replay Prime Invariant ----
  // While Bar Replay is active, every ANALYTICS consumer (mood engine, market
  // context, scanner, SMC, divergence) sees candles only up to the replay
  // moment — higher-TF forming bars are synthesized, never leaked from the
  // stored (fully formed) history. The chart itself keeps the full eval-TF
  // array: the replay machinery (selector, scrubber) needs it.
  const replayCut = useReplayCut();
  const analyticsCandlesByTf = useMemo(
    () =>
      replayCut.active && replayCut.cutBar
        ? sliceCandlesByTf(candlesByTf, replayCut.evalTf, replayCut.cutBar)
        : candlesByTf,
    [candlesByTf, replayCut],
  );

  // ---- Mood engine ----
  const { prices, changes, snapshots, mood, indicatorRows } = useMoodEngine(
    analyticsCandlesByTf,
    activeIndicatorIds,
  );

  // ---- History window (jump-to-date) ----
  const { historyCandles, fitSignal, jumpToDate, returnToLive, loadOlderHistory } =
    useHistoryWindow(selected, symbol);

  const handleLoadOlder = useCallback(() => {
    if (historyCandles) loadOlderHistory();
    else loadOlder(selected);
  }, [historyCandles, loadOlderHistory, loadOlder, selected]);

  // ---- Derived display values ----
  const currentCandles = candlesByTf[selected];

  // One Market Context for the whole app (chart gate + widget + rail share it).
  const marketContext = useMarketContext(analyticsCandlesByTf);
  const scannerSnapshot = useScannerEngine(analyticsCandlesByTf, selected);

  // Emission boundary: on each closed bar this yields the current SdSignal[].
  // Phase 2 alerts/webhooks subscribe by diffing newly-`triggered` ids here.
  const signalEvents = useMemo(
    () => computeSdSignalEvents(analyticsCandlesByTf[selected] ?? [], { id: 'sd_signals' }, { symbol, timeframe: selected }),
    [currentCandles, symbol, selected],
  );

  const currentPrice = ticker24h ? ticker24h.price : prices[selected];
  const currentChange = ticker24h ? ticker24h.change : changes[selected];
  const mid = useMemo(
    () => (currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].close : 0),
    [currentCandles],
  );
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;

  const bottomPanelRef = useRef<PanelImperativeHandle>(null);

  // ---- Alerts ----
  useAlerts(symbol, snapshots, bid, ask, currentPrice, replayCut.active);

  // ---- Render ----
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden">
      <main className="flex min-h-0 w-full flex-1 relative">
        {/* Left Drawing Rail (Placeholder for Phase 5) */}
        {/* <div className="w-[50px] border-r border-line bg-surface flex-shrink-0" /> */}

        {/* Center Canvas Area */}
        <div className="flex flex-1 flex-col min-w-0 h-full">
          <PanelGroup orientation="vertical">
            <Panel defaultSize={75} minSize={20}>
              <div className="flex-1 flex flex-col h-full relative">

                {gridLayout.mode === 'multi-chart' ? (
                  <MultiChartGrid
                    count={gridLayout.count}
                    tfs={gridTfs}
                    candlesByTf={analyticsCandlesByTf}
                    chartType={chartType}
                    activeIndicatorIds={activeIndicatorIds}
                    selected={selected}
                    onSelectTf={setSelected}
                    sync={gridLayout.sync}
                  />
                ) : (
                  <ChartPanel
                    candles={historyCandles ?? currentCandles}
                    candlesByTf={analyticsCandlesByTf}
                    type={chartType}
                    onTypeChange={setChartType}
                    selected={selected}
                    onSelectTf={setSelected}
                    symbol={symbol}
                    price={currentPrice}
                    change={currentChange}
                    status={status}
                    showVolume={showVolume}
                    onQuickTrade={() => { setTab('trade'); setRightPanel('signals'); }}
                    bid={bid}
                    ask={ask}
                    activeIndicatorIds={activeIndicatorIds}
                    onToggleIndicator={toggleIndicator}
                    onClearIndicators={clearIndicators}
                    onLoadOlder={handleLoadOlder}
                    historyActive={historyCandles != null}
                    onJumpToDate={jumpToDate}
                    onReturnToLive={returnToLive}
                    fitSignal={fitSignal}
                    gridCount={gridCount}
                    onGridChange={handleGridCountChange}
                    layout={gridLayout}
                    onLayoutChange={setGridLayout}
                    paneCount={gridLayout.mode === 'multi-pane' ? gridLayout.count : 1}
                    workspaceCurrent={{ chartType, symbol, tf: selected, indicatorIds: activeIndicatorIds }}
                    onWorkspaceApply={applyWorkspace}
                  />
                )}

                {gridLayout.mode === 'single' && (
                  <ScannerSignalsDock snapshot={scannerSnapshot} midPrice={currentPrice ?? undefined} />
                )}

                {/* Compact Market Context widget (Phase 11) — same MarketContext
                    object as the signal gate; click opens the MTF rail. */}
                {gridLayout.mode === 'single' && (
                  <div className="absolute right-[84px] top-[52px] z-20 hidden lg:block">
                    <MarketContextWidget
                      ctx={marketContext}
                      onOpenDetails={() => { setTab('signals'); setRightPanel('signals'); }}
                    />
                  </div>
                )}

              </div>
            </Panel>

            <PanelResizeHandle className="h-1.5 w-full bg-line hover:bg-accent/40 cursor-row-resize transition relative z-20" />

            <Panel panelRef={bottomPanelRef} defaultSize={25} minSize={5} collapsible>
              <BottomDock
                tf={selected}
                candles={currentCandles}
                activeIndicators={activeIndicators}
                onToggleIndicator={handleToggleIndicator}
                onAddIndicator={handleAddIndicator}
                onRemoveIndicator={handleRemoveIndicator}
                showVolume={showVolume}
                onToggleVolume={toggleVolume}
                candlesByTf={analyticsCandlesByTf}
                snapshots={snapshots}
                selected={selected}
                onSelectTf={setSelected}
                onToggleCollapse={() => {
                  const p = bottomPanelRef.current;
                  if (p) {
                    if (p.isCollapsed()) p.expand();
                    else p.collapse();
                  }
                }}
              />
            </Panel>
          </PanelGroup>
        </div>

        {/* Right Data Rail — docked sibling so the chart reflows beside it
            (never overlaps the price scale / canvas controls). The far-right
            icon dock selects which panel is shown (one at a time). */}
        {rightPanel && (
          <aside className="hidden xl:flex w-[450px] shrink-0 border-l border-line bg-surface flex-col min-h-0 overflow-y-auto">
            {rightPanel === 'mood' && (
              <MoodStrip
                symbol={symbol}
                onSymbolChange={setSymbol}
                status={status}
                dataState={dataState}
                price={currentPrice}
                change={currentChange}
                mood={mood}
                snapshots={snapshots}
                timeframes={TIMEFRAMES}
              />
            )}
            {rightPanel === 'signals' && (
              <DashboardAside
                snapshots={snapshots}
                timeframes={TIMEFRAMES}
                selected={selected}
                onSelectTf={setSelected}
                indicatorRows={indicatorRows}
                symbol={symbol}
                midPrice={currentPrice ?? mid}
                tab={tab}
                onTabChange={setTab}
                signals={signalEvents}
              />
            )}
            {rightPanel === 'orderflow' && <OrderFlowPanel symbol={symbol} tf={selected} />}
            {rightPanel === 'scanner' && <TechnicalScannerPanel candlesByTf={analyticsCandlesByTf} evalTf={selected} />}
          </aside>
        )}

        {/* Far-right icon dock — always visible, toggles the rail panels. */}
        <RightDock active={rightPanel} onSelect={selectRightPanel} />
      </main>

      {/* Hidden old components removed */}

      <SymbolSearch
        open={searchOpen}
        current={symbol}
        onClose={() => setSearchOpen(false)}
        onSelect={(s) => {
          if (isCompareSymbol(s)) setSymbol(s);
        }}
      />

    </div>
  );
}


