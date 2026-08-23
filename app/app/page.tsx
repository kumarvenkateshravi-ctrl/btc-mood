'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
// Charts are lazy-loaded (DESIGN.md §L budget). lightweight-charts (~3MB) is
// only imported through ChartPanel + MultiChartGrid; making BOTH dynamic keeps
// it out of /app's initial bundle until a chart actually renders. BottomDock is
// below the fold, so it's deferred too.
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
import type { GridCellConfig } from '@/components/MultiChartGrid';
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
import WatchlistPanel from '@/components/WatchlistPanel';
import { closePosition, partialClose, placeOrder, updatePositionProtection } from '@/lib/paperStore';
import { deriveActivePosition } from '@/lib/trade/activePosition';
import { useActiveTradePresentation } from '@/lib/trade/presentationFacade';
import { createChartTradingController, type ChartTradingControllerSession } from '@/lib/chartTradingController';
import ActivePositionWidget from '@/components/trade/ActivePositionWidget';
import WidgetsPanel, { DEFAULT_WIDGET_PREFS, type WidgetKey, type WidgetPrefs } from '@/components/WidgetsPanel';
import DailyOrderFlowWidget from '@/components/DailyOrderFlowWidget';
import { useDrawings, getDrawings, setDrawings } from '@/lib/drawings';
import { useSharedIndicators } from '@/lib/useSharedIndicators';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import {
  DEFAULT_COMPARE_SYMBOL,
  isCompareSymbol,
  type CompareSymbol,
} from '@/lib/compare';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
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
import { useReplayDataset } from '@/lib/replay/replayDataset';
import { replayClose, replayOpenWithRisk, replayPartialClose, replayUpdateProtection, setPendingLevels, setReplayActionContext } from '@/lib/replaySession';
import { planDeepLoad } from '@/lib/replay/deepLoad';
import { useAnalyticsWindow } from '@/lib/hooks/useAnalyticsWindow';
import { sliceCandlesByTf } from '@/lib/replay/replaySlice';
import { useLayoutMigrationToast } from '@/components/useLayoutMigrationToast';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { useMarketState } from '@/lib/hooks/useMarketState';
import { computeUtcDayChange } from '@/lib/utcDayChange';
import { isPriceExecutionTrusted } from '@/lib/marketDataIntegrity';
import { setMarketDataReplayActive } from '@/lib/marketDataTrust';

export default function DashboardPage() {
  // ---- Core view state ----
  const [selected, setSelected] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [symbol, setSymbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [hydrated, setHydrated] = useState(false);
  const [indicatorState, setIndicatorState] = useState<{ past: string[][], present: string[], future: string[][] }>({ past: [], present: [], future: [] });
  const activeIndicatorIds = indicatorState.present;

  const setActiveIndicatorIds = useCallback((action: string[] | ((prev: string[]) => string[])) => {
    setIndicatorState((state) => {
      const next = typeof action === 'function' ? action(state.present) : action;
      if (next === state.present) return state;
      return {
        past: [...state.past, state.present].slice(-50),
        present: next,
        future: []
      };
    });
  }, []);

  const undoIndicators = useCallback(() => {
    setIndicatorState((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, state.past.length - 1);
      return { past: newPast, present: previous, future: [state.present, ...state.future] };
    });
  }, []);

  const redoIndicators = useCallback(() => {
    setIndicatorState((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return { past: [...state.past, state.present], present: next, future: newFuture };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) redoIndicators();
        else undoIndicators();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        redoIndicators();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoIndicators, redoIndicators]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<'signals' | 'trade' | 'trades'>('signals');
  // Which right-rail panel is shown (null = collapsed). Driven by the far-right icon dock.
  const [rightPanel, setRightPanel] = useState<RightPanelId | null>('signals');

  const selectRightPanel = useCallback(
    (id: RightPanelId) => setRightPanel((p) => (p === id ? null : id)),
    [],
  );

  const toggleIndicator = useCallback((id: string) => {
    const instanceId = `${id}::${Math.random().toString(36).slice(2, 8)}`;
    setActiveIndicatorIds((prev) => [...prev, instanceId]);
  }, []);
  const removeIndicator = useCallback((id: string) => {
    setActiveIndicatorIds((prev) => prev.filter((x) => x !== id));
  }, []);
  const clearIndicators = useCallback(() => setActiveIndicatorIds([]), []);

  const { gridCount, gridTfs, layout: gridLayout, setLayout: setGridLayout, handleGridCountChange, migrated: layoutMigrated, previousCount: layoutPreviousCount } = useGridState(selected);

  // ---- Multi-chart per-cell config (each chart owns tf/type/indicators;
  // the SELECTED cell is what the main toolbar controls) ----
  const [gridCells, setGridCells] = useState<GridCellConfig[]>([]);
  const [selectedCell, setSelectedCell] = useState(0);
  // Seed / resize the cell list from the layout + current globals when the
  // multi-chart layout or its count changes.
  useEffect(() => {
    if (gridLayout.mode !== 'multi-chart') return;
    setGridCells((prev) => {
      if (prev.length === gridLayout.count) return prev;
      return Array.from({ length: gridLayout.count }, (_, i) =>
        prev[i] ?? { tf: gridTfs[i] ?? selected, type: chartType, indicatorIds: activeIndicatorIds });
    });
    setSelectedCell((s) => (s < gridLayout.count ? s : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridLayout.mode, gridLayout.count, gridTfs]);

  const inMultiChart = gridLayout.mode === 'multi-chart' && gridCells.length > 0;
  const selCell = inMultiChart ? Math.min(selectedCell, gridCells.length - 1) : 0;
  const patchCell = useCallback((patch: Partial<GridCellConfig>) => {
    setGridCells((cells) => cells.map((c, i) => (i === selCell ? { ...c, ...patch } : c)));
  }, [selCell]);

  // The toolbar binds to the selected cell in multi-chart mode, else globals.
  const toolbarTf = inMultiChart ? gridCells[selCell].tf : selected;
  const toolbarType = inMultiChart ? gridCells[selCell].type : chartType;
  const toolbarIndicatorIds = inMultiChart ? gridCells[selCell].indicatorIds : activeIndicatorIds;
  const onToolbarSelectTf = useCallback((tf: Timeframe) => {
    if (inMultiChart) patchCell({ tf }); else setSelected(tf);
  }, [inMultiChart, patchCell]);
  const onToolbarSelectType = useCallback((t: import('@/components/Chart').ChartType) => {
    if (inMultiChart) patchCell({ type: t }); else setChartType(t);
  }, [inMultiChart, patchCell]);
  const onToolbarToggleIndicator = useCallback((id: string) => {
    if (!inMultiChart) { toggleIndicator(id); return; }
    setGridCells((cells) => cells.map((c, i) => i === selCell
      ? { ...c, indicatorIds: c.indicatorIds.includes(id) ? c.indicatorIds.filter((x) => x !== id) : [...c.indicatorIds, id] }
      : c));
  }, [inMultiChart, selCell, toggleIndicator]);
  const onToolbarRemoveIndicator = useCallback((id: string) => {
    if (!inMultiChart) { removeIndicator(id); return; }
    setGridCells((cells) => cells.map((c, i) => i === selCell ? { ...c, indicatorIds: c.indicatorIds.filter((x) => x !== id) } : c));
  }, [inMultiChart, selCell, removeIndicator]);
  const onToolbarClearIndicators = useCallback(() => {
    if (inMultiChart) patchCell({ indicatorIds: [] }); else clearIndicators();
  }, [inMultiChart, patchCell, clearIndicators]);

  useLayoutMigrationToast({ migrated: layoutMigrated, previousCount: layoutPreviousCount });

  // Explicit workspace application is a user command: it intentionally applies the
  // workspace snapshot immediately. Initial hydration uses URL > workspace >
  // persisted > default; no persisted write can override this command.
  const applyWorkspace = useCallback((cfg: WorkspaceConfig) => {
    if (cfg.chartType === 'candlestick' || cfg.chartType === 'heikinAshi' || cfg.chartType === 'renko') {
      setChartType(cfg.chartType);
    }
    if (isCompareSymbol(cfg.symbol)) setSymbol(cfg.symbol);
    if ((TIMEFRAMES as string[]).includes(cfg.tf)) setSelected(cfg.tf as Timeframe);
    setActiveIndicatorIds(cfg.indicatorIds.map(id => id.includes('::') ? id : `${id}::default`).filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id.split('::')[0])));
  }, []);

  const { activeIndicators, showVolume, toggleVolume, handleAdd: handleAddIndicator, handleRemove: handleRemoveIndicator, handleToggle: handleToggleIndicator } = useSharedIndicators();

  const currentDrawings = useDrawings(symbol);

  // ---- Hydrate from URL + localStorage ----
  useEffect(() => {
    const init = readInitialState();
    setSymbol(init.symbol);
    setSelected(init.tf);
    setChartType(init.type);
    setRightPanel(init.rightPanel);
    if (init.indicators && init.indicators.length) {
      setActiveIndicatorIds(init.indicators.map(id => id.includes('::') ? id : id + '::default').filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id.split('::')[0])));
    }
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
  const { candlesByTf, status, integrity, bookTicker, ticker24h, loadOlder, loadHistoryUntil, wsStatus, lastUpdateMs } =
    useMarketData(symbol);

  // Deep backfill for replay practice: load the selected TF (and everything
  // above it) back to the requested date, sequentially, reporting progress.
  const deepLoadHistory = useCallback(
    async (
      targetMs: number,
      onProgress?: (p: { tf: Timeframe; pages: number; oldestMs: number }) => void,
      signal?: AbortSignal,
    ) => {
      const steps = planDeepLoad(selected, targetMs, Date.now());
      for (const step of steps) {
        if (signal?.aborted) return;
        await loadHistoryUntil(step.tf, step.untilMs, step.maxPages, onProgress, signal);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, loadHistoryUntil],
  );

  const hasMarketData = TIMEFRAMES.some((tf) => candlesByTf[tf].length > 0);
  const dataState = useMarketState({ wsStatus, lastUpdateMs, hasData: hasMarketData });

  // ---- Replay Prime Invariant ----
  // While Bar Replay is active, every ANALYTICS consumer (mood engine, market
  // context, scanner, SMC, divergence) sees candles only up to the replay
  // moment — higher-TF forming bars are synthesized, never leaked from the
  // stored (fully formed) history. The chart itself keeps the full eval-TF
  // array: the replay machinery (selector, scrubber) needs it.
  const replayCut = useReplayCut();
  const replayDataset = useReplayDataset();
  const replaySnapshotCandlesByTf = useMemo(
    () => Object.fromEntries(TIMEFRAMES.map((tf) => [tf, (replayDataset.candlesByTf[tf] ?? []).slice()])) as Record<Timeframe, Candle[]>,
    [replayDataset],
  );
  const replaySourceCandlesByTf = replayDataset.active ? replaySnapshotCandlesByTf : candlesByTf;
  const executionIntegrity = replayCut.active ? 'replay' : integrity;
  useEffect(() => {
    setMarketDataReplayActive(replayCut.active);
    return () => setMarketDataReplayActive(false);
  }, [replayCut.active]);
  const analyticsCandlesByTfFull = useMemo(
    () =>
      replayCut.active && replayCut.cutBar
        ? sliceCandlesByTf(replaySourceCandlesByTf, replayCut.evalTf, replayCut.cutBar)
        : replaySourceCandlesByTf,
    [replaySourceCandlesByTf, replayCut],
  );
  // Live-edge analytics window (mood/context/scanner/signals): capped tails
  // with referential stability — a lazy-load prepend of old bars produces the
  // IDENTICAL object, so none of the engines below recompute (this was the
  // ~2s main-thread stall during zoom-out). The chart keeps full history.
  const analyticsCandlesByTf = useAnalyticsWindow(analyticsCandlesByTfFull);

  // ---- Mood engine ----
  const { prices, snapshots, mood, indicatorRows } = useMoodEngine(
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
  const currentCandles = replayDataset.active
    ? replaySnapshotCandlesByTf[selected]
    : (historyCandles ?? candlesByTf[selected]);

  // One Market Context for the whole app (chart gate + widget + rail share it).
  const marketContext = useMarketContext(analyticsCandlesByTf);
  const scannerSnapshot = useScannerEngine(analyticsCandlesByTf, selected);

  // Emission boundary: on each closed bar this yields the current SdSignal[].
  // Phase 2 alerts/webhooks subscribe by diffing newly-`triggered` ids here.
  const signalEvents = useMemo(
    () => computeSdSignalEvents(analyticsCandlesByTf[selected] ?? [], { id: 'sd_signals' }, { symbol, timeframe: selected }),
    // Keyed on the WINDOWED slice: stable across prepends, fresh per tick.
    [analyticsCandlesByTf, symbol, selected],
  );

  const currentPrice = replayCut.active
    ? (replayCut.cutBar?.close ?? prices[selected])
    : (ticker24h ? ticker24h.price : prices[selected]);

  // Binance's ticker change is a rolling 24-hour value. The dashboard display
  // uses the UTC calendar-day session instead: current price versus the candle
  // that opened at 00:00 UTC today.
  const utcDayChange = useMemo(
    () => computeUtcDayChange(currentPrice, candlesByTf),
    [currentPrice, candlesByTf],
  );

  // Active-position cockpit reads the current execution owner, never a cached
  // live position. Replay can therefore present its isolated session safely.
  const activePresentation = useActiveTradePresentation({
    mode: replayCut.active ? 'replay' : 'live',
    symbol,
    markPrice: currentPrice,
    markTrusted: isPriceExecutionTrusted(executionIntegrity),
  });
  const activeTradeCommandContextRef = useRef<ChartTradingControllerSession>({ mode: 'live', symbol });
  activeTradeCommandContextRef.current = { mode: replayCut.active ? 'replay' : 'live', symbol };
  // One controller per active chart session. The controller is recreated for
  // mode/symbol/visual-session replacement and the prior reference is disposed
  // by the effect cleanup, so stale chart callbacks cannot remain usable.
  const chartControllerSessionKey = [
    replayCut.active ? 'replay' : 'live',
    symbol,
    toolbarTf,
    toolbarType,
    replayDataset.active ? replayDataset.sessionId : 'live',
  ].join(':');
  const activeTradeCommands = useMemo(
    () => createChartTradingController({
      getSession: () => activeTradeCommandContextRef.current,
      live: {
        placeOrder,
        closePosition,
        updateProtection: updatePositionProtection,
        partialClose,
      },
      replay: {
        setActionContext: setReplayActionContext,
        setPendingLevels,
        openWithRisk: replayOpenWithRisk,
        updateProtection: replayUpdateProtection,
        close: replayClose,
        partialClose: replayPartialClose,
      },
    }),
    [chartControllerSessionKey],
  );
  useEffect(() => {
    activeTradeCommands.activate();
    return () => activeTradeCommands.dispose();
  }, [activeTradeCommands]);
  const activePosition = activePresentation.position;
  const activeView =
    activePosition && currentPrice != null
      ? deriveActivePosition(activePosition, currentPrice, Date.now())
      : null;
  const [widgetPrefs, setWidgetPrefs] = useState<WidgetPrefs>(DEFAULT_WIDGET_PREFS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('widgetPrefs');
      if (raw) setWidgetPrefs({ ...DEFAULT_WIDGET_PREFS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);
  const toggleWidget = useCallback((key: WidgetKey) => {
    setWidgetPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('widgetPrefs', JSON.stringify(next)); } catch { /* ignore */ }
      // Turning the Active Trade widget ON jumps to the Mood section so the
      // user immediately sees btc-mood WITH the widget docked below it
      // (its home) — otherwise clicking Show gives no visible feedback.
      if (key === 'activeTrade' && next.activeTrade) setRightPanel('mood');
      if (key === 'dailyOrderFlow' && next.dailyOrderFlow) setRightPanel('mood');
      return next;
    });
  }, []);
  const currentChange = utcDayChange?.percent ?? null;
  const currentChangeAbs = utcDayChange?.absolute ?? null;
  const mid = useMemo(
    () => (currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].close : 0),
    [currentCandles],
  );
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;

  const bottomPanelRef = useRef<PanelImperativeHandle>(null);

  // ---- Alerts ----
  useAlerts(
    symbol,
    snapshots,
    bid,
    ask,
    currentPrice,
    replayCut.active,
    isPriceExecutionTrusted(executionIntegrity),
  );

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

                {(
                  <ChartPanel
                    multiChartSlot={gridLayout.mode === 'multi-chart' ? (
                      <MultiChartGrid
                        cells={gridCells}
                        candlesByTf={analyticsCandlesByTf}
                        selectedIndex={selCell}
                        onSelectCell={setSelectedCell}
                        onRemoveCellIndicator={(idx, id) =>
                          setGridCells((cs) => cs.map((c, i) => i === idx
                            ? { ...c, indicatorIds: c.indicatorIds.filter((x) => x !== id) }
                            : c))}
                        sync={gridLayout.sync}
                      />
                    ) : undefined}
                    onDeepLoadHistory={deepLoadHistory}
                    candles={currentCandles}
                    candlesByTf={analyticsCandlesByTf}
                    type={toolbarType}
                    onTypeChange={onToolbarSelectType}
                    selected={toolbarTf}
                    onSelectTf={onToolbarSelectTf}
                    symbol={symbol}
                    onSelectSymbol={(next) => { if (isCompareSymbol(next)) setSymbol(next); }}
                    price={currentPrice}
                    changeAbs={currentChangeAbs}
                    change={currentChange}
                    status={status}
                    marketIntegrity={integrity}
                    connectionStatus={wsStatus}
                    tradingCommands={activeTradeCommands}
                    tradePresentation={activePresentation}
                    showVolume={showVolume}
                    onQuickTrade={() => { setTab('trade'); setRightPanel('signals'); }}
                    bid={bid}
                    ask={ask}
                    activeIndicatorIds={toolbarIndicatorIds}
                    onToggleIndicator={onToolbarToggleIndicator}
                    onRemoveIndicator={onToolbarRemoveIndicator}
                    onClearIndicators={onToolbarClearIndicators}
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
                {gridLayout.mode === 'single' && widgetPrefs.marketContext && (
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
                symbol={symbol}
                tradePresentation={activePresentation}
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
            {rightPanel === 'watchlist' && (
              <WatchlistPanel
                activeSymbol={symbol}
                onSelect={(s) => { if (isCompareSymbol(s)) setSymbol(s); }}
              />
            )}
            {rightPanel === 'mood' && (
              // Explicit vertical stack: btc-mood card, then the Active Trade
              // card below it, separated by a gap. Both are normal-flow blocks
              // (shrink-0) so neither can overlay the other.
              <div className="flex flex-col gap-4 p-4">
                <div className="shrink-0">
                  <MoodStrip
                    symbol={symbol}
                    onSymbolChange={setSymbol}
                    status={status}
                    dataState={dataState}
                    price={currentPrice}
                    change={currentChange}
                    changeAbs={currentChangeAbs}
                    volume={ticker24h?.volume ?? null}
                    mood={mood}
                    snapshots={snapshots}
                    timeframes={TIMEFRAMES}
                  />
                </div>
                <div className="shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
                  <WatchlistPanel
                    activeSymbol={symbol}
                    onSelect={(s) => { if (isCompareSymbol(s)) setSymbol(s); }}
                  />
                </div>
                {widgetPrefs.dailyOrderFlow && (
                  <div className="shrink-0">
                    {/* Keyed so a symbol switch remounts with a clean day accumulator. */}
                    <DailyOrderFlowWidget
                      key={symbol}
                      symbol={symbol}
                      candles={(replayDataset.active ? replayDataset.candlesByTf['5m'] ?? [] : candlesByTf['5m']).slice()}
                    />
                  </div>
                )}
                {widgetPrefs.activeTrade && activeView && activePosition && (
                  <div className="shrink-0">
                    <ActivePositionWidget
                      mode={activePresentation.mode}
                      view={activeView}
                      onMoveBreakEven={() => activeTradeCommands.setOverlay({ symbol, field: 'sl', value: activePosition.entryPrice })}
                      onClosePartial={(f) => activeTradeCommands.partialClose({ symbol, fraction: f, mark: currentPrice ?? activePosition.entryPrice })}
                      onToggleTrailing={() => activeTradeCommands.toggleTrailing({ symbol, enabled: !activePosition.trailingSl })}
                      onCloseFull={() => activeTradeCommands.close({ symbol, mark: currentPrice ?? activePosition.entryPrice })}
                    />
                  </div>
                )}
              </div>
            )}
            {rightPanel === 'widgets' && (
              <WidgetsPanel prefs={widgetPrefs} onToggle={toggleWidget} hasActiveTrade={!!activeView} />
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
                tradePresentation={activePresentation}
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

