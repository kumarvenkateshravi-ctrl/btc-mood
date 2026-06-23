'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, type PanelImperativeHandle } from 'react-resizable-panels';
import BottomDock from '@/components/BottomDock';
import MultiChartGrid from '@/components/MultiChartGrid';
import SymbolSearch from '@/components/SymbolSearch';
import DashboardAside from '@/components/DashboardAside';
import MoodStrip from '@/components/MoodStrip';
import OrderFlowPanel from '@/components/OrderFlowPanel';
import RightDock, { type RightPanelId } from '@/components/RightDock';
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
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';

export default function DashboardPage() {
  // ---- Core view state ----
  const [selected, setSelected] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [symbol, setSymbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [hydrated, setHydrated] = useState(false);
  const [activeIndicatorIds, setActiveIndicatorIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<'signals' | 'trade'>('signals');
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

  const { gridCount, gridTfs, setGridCount, handleGridCountChange } = useGridState(selected);

  const applyWorkspace = useCallback((cfg: WorkspaceConfig) => {
    if (cfg.chartType === 'candlestick' || cfg.chartType === 'heikinAshi' || cfg.chartType === 'renko') {
      setChartType(cfg.chartType);
    }
    if (isCompareSymbol(cfg.symbol)) setSymbol(cfg.symbol);
    if ((TIMEFRAMES as string[]).includes(cfg.tf)) setSelected(cfg.tf as Timeframe);
    setActiveIndicatorIds(cfg.indicatorIds.filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id)));
  }, []);

  const { activeIndicators, showVolume, toggleVolume, handleAdd: handleAddIndicator, handleRemove: handleRemoveIndicator, handleToggle: handleToggleIndicator, handleParam: handleParamChange } = useSharedIndicators();

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
      if (rp === 'mood' || rp === 'signals' || rp === 'orderflow') setRightPanel(rp);
      else if (rp === 'none') setRightPanel(null);
    } catch {}
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
    writeUrlState(selected, chartType, symbol, activeIndicatorIds);
  }, [hydrated, selected, chartType, symbol, activeIndicatorIds]);

  // ---- Keyboard shortcuts ----
  useKeyboardShortcuts({
    onSearch: () => setSearchOpen(true),
    onSelectTf: setSelected,
    onChartType: setChartType,
    gridCount,
    onGridCycle: handleGridCountChange,
  });

  // ---- Market data pipeline ----
  const { candlesByTf, errorsByTf, status, wsStatus, bookTicker, wsBarCount, loadOlder } =
    useMarketData(symbol);

  // ---- Mood engine ----
  const { prices, changes, snapshots, mood, indicatorRows } = useMoodEngine(
    candlesByTf,
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
  const currentPrice = prices[selected];
  const currentChange = changes[selected];
  const mid = useMemo(
    () => (currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].close : 0),
    [currentCandles],
  );
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;

  const bottomPanelRef = useRef<PanelImperativeHandle>(null);

  // ---- Alerts ----
  useAlerts(symbol, snapshots, bid, ask, currentPrice);

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

                {gridCount > 1 ? (
                  <MultiChartGrid
                    count={gridCount}
                    tfs={gridTfs}
                    candlesByTf={candlesByTf}
                    chartType={chartType}
                    activeIndicatorIds={activeIndicatorIds}
                    selected={selected}
                    onSelectTf={setSelected}
                  />
                ) : (
                  <ChartPanel
                    candles={historyCandles ?? currentCandles}
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
                    workspaceCurrent={{ chartType, symbol, tf: selected, indicatorIds: activeIndicatorIds }}
                    onWorkspaceApply={applyWorkspace}
                  />
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
                candlesByTf={candlesByTf}
                snapshots={snapshots}
                prices={prices}
                changes={changes}
                errors={errorsByTf}
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
              />
            )}
            {rightPanel === 'orderflow' && <OrderFlowPanel symbol={symbol} tf={selected} />}
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
