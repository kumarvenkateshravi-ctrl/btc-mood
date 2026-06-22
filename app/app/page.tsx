'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '@/components/Header';
import dynamic from 'next/dynamic';
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
import TimeframeStrip from '@/components/TimeframeStrip';
import ConfluenceRibbon from '@/components/ConfluenceRibbon';
import MultiChartGrid from '@/components/MultiChartGrid';
import SymbolSearch from '@/components/SymbolSearch';
import DashboardAside from '@/components/DashboardAside';
import Kbd from '@/components/Kbd';
import MoodStrip from '@/components/MoodStrip';
import OrderFlowPanel from '@/components/OrderFlowPanel';
import AlertsPanel from '@/components/AlertsPanel';
import BacktestPanel from '@/components/BacktestPanel';
import IndicatorPicker from '@/components/trade/IndicatorPicker';
import TradeHistory from '@/components/trade/TradeHistory';
import BacktestStats from '@/components/trade/BacktestStats';
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
  POLL_MS,
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
    setHydrated(true);
  }, []);

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

  // ---- Alerts ----
  useAlerts(symbol, snapshots, bid, ask, currentPrice);

  // ---- Render ----
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex w-full flex-1 flex-col gap-5 px-3 py-4 sm:px-4 sm:py-6">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">

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
                onQuickTrade={() => setTab('trade')}
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

            <ConfluenceRibbon
              candlesByTf={candlesByTf}
              timeframes={TIMEFRAMES}
              selected={selected}
              snapshots={snapshots}
              onSelectTf={setSelected}
            />

            <section>
              <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
                Confluence across timeframes
              </h2>
              <TimeframeStrip
                selected={selected}
                onSelect={setSelected}
                prices={prices}
                changes={changes}
                snapshots={snapshots}
                errors={errorsByTf}
                timeframes={TIMEFRAMES}
              />
            </section>
          </div>

          <aside className="hidden min-w-0 flex-col gap-4 xl:flex">
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
            <OrderFlowPanel symbol={symbol} tf={selected} />
          </aside>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <TradeHistory />
          <BacktestStats />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="xl:col-start-2">
            <IndicatorPicker
              active={activeIndicators}
              onAdd={handleAddIndicator}
              onRemove={handleRemoveIndicator}
              onToggle={handleToggleIndicator}
              onParam={handleParamChange}
              showVolume={showVolume}
              onToggleVolume={toggleVolume}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BacktestPanel tf={selected} candles={currentCandles} />
          <AlertsPanel defaultTf={selected} />
        </div>
      </main>

      <SymbolSearch
        open={searchOpen}
        current={symbol}
        onClose={() => setSearchOpen(false)}
        onSelect={(s) => {
          if (isCompareSymbol(s)) setSymbol(s);
        }}
      />

      <footer className="border-t border-line bg-base/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-3 py-4 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span>
            Educational use only, not financial advice. Live data via Binance
            WebSocket; periodic reconciliation every {POLL_MS / 1000}s.
          </span>
          <span className="flex items-center gap-3">
            <span className="hidden items-center gap-1 md:inline-flex">
              <Kbd>1</Kbd>…<Kbd>6</Kbd> timeframe · <Kbd>H</Kbd> Heikin · <Kbd>C</Kbd> candles · <Kbd>R</Kbd> renko · <Kbd>G</Kbd> grid · <Kbd>/</Kbd> search · <Kbd>F</Kbd> full
            </span>
            <span className="font-mono">
              ws: {wsStatus}
              {wsBarCount > 0 ? ` · ${wsBarCount} bars` : ''}
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
