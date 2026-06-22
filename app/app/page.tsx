'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import Header from '@/components/Header';
import dynamic from 'next/dynamic';
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
import TimeframeStrip from '@/components/TimeframeStrip';
import ConfluenceRibbon from '@/components/ConfluenceRibbon';
import MultiChartGrid from '@/components/MultiChartGrid';
import WorkspaceMenu from '@/components/WorkspaceMenu';
import SymbolSearch from '@/components/SymbolSearch';
import { Square } from 'lucide-react';
import GridCountControl from '@/components/GridCountControl';
import {
  DEFAULT_GRID_COUNT,
  isGridCount,
  loadGrid,
  reconcileGridTfs,
  saveGrid,
  tfsForCount,
  type GridCount,
} from '@/lib/gridLayout';
import type { WorkspaceConfig } from '@/lib/workspaces';
import MoodStrip from '@/components/MoodStrip';
import SignalMatrix from '@/components/SignalMatrix';
import AlertsPanel from '@/components/AlertsPanel';
import BacktestPanel from '@/components/BacktestPanel';
import IndicatorPicker from '@/components/trade/IndicatorPicker';
import TradeHistory from '@/components/trade/TradeHistory';
import BacktestStats from '@/components/trade/BacktestStats';
import TradingPanel from '@/components/trade/TradingPanel';
import { useSharedIndicators } from '@/lib/useSharedIndicators';
import { synthCandles } from '@/lib/binance';
import { fetchKlinesTyped, fetchKlinesBefore, klinesQueryKey, KlinesError, RateLimitedError } from '@/lib/fetcher';
import { aggregateMood, computeSignal, type MoodVerdict, type TFSnapshot } from '@/lib/signals';
import { CUSTOM_INDICATORS } from '@/lib/customIndicatorsLibrary';
import type { Candle } from '@/lib/types';
import { subscribeKlines, subscribeBookTicker, type BookTicker, type WSStatus } from '@/lib/ws';
import {
  DEFAULT_COMPARE_SYMBOL,
  type CompareSymbol,
  isCompareSymbol,
} from '@/lib/compare';
import { loadRules, rulesToFire, saveRules, type AlertSide } from '@/lib/alerts';
import { priceAlertsToFire } from '@/lib/priceAlerts';
import { getPriceAlerts, markPriceAlertsFired } from '@/lib/priceAlertsStore';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import { reconcileBar } from '@/lib/paperStore';
import type { ChartOverlay, OverlayKind } from '@/components/Chart';

const POLL_MS = 30000; // periodic reconciliation in case WS drops a bar
const INDICATORS_KEY = 'btc-mood:chart-indicators:v1';
const TF_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

function parseChartType(param: string | null): ChartType | null {
  if (param === 'ha') return 'heikinAshi';
  if (param === 'renko') return 'renko';
  if (param === 'candle' || param === 'candlestick') return 'candlestick';
  return null;
}

// Initial state from URL (shared links) with sensible defaults.
function readInitialState(): {
  tf: Timeframe;
  type: ChartType;
  symbol: CompareSymbol;
  indicators: string[] | null;
} {
  if (typeof window === 'undefined') {
    return { tf: '15m', type: 'candlestick', symbol: DEFAULT_COMPARE_SYMBOL, indicators: null };
  }
  const sp = new URLSearchParams(window.location.search);
  const tfParam = sp.get('tf');
  const symbolParam = sp.get('symbol') ?? DEFAULT_COMPARE_SYMBOL;
  const tf: Timeframe = (TIMEFRAMES as string[]).includes(tfParam ?? '') ? (tfParam as Timeframe) : '15m';
  const type: ChartType = parseChartType(sp.get('type')) ?? 'candlestick';
  const symbol: CompareSymbol = isCompareSymbol(symbolParam) ? symbolParam : DEFAULT_COMPARE_SYMBOL;
  const indParam = sp.get('ind');
  const indicators = indParam
    ? indParam.split(',').filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id))
    : null;
  return { tf, type, symbol, indicators };
}

function writeUrlState(tf: Timeframe, type: ChartType, symbol: CompareSymbol, indicators: string[]) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (tf === '15m') sp.delete('tf'); else sp.set('tf', tf);
  if (type === 'candlestick') sp.delete('type');
  else sp.set('type', type === 'heikinAshi' ? 'ha' : type === 'renko' ? 'renko' : 'candle');
  if (symbol === DEFAULT_COMPARE_SYMBOL) sp.delete('symbol');
  else sp.set('symbol', symbol);
  if (indicators.length === 0) sp.delete('ind');
  else sp.set('ind', indicators.join(','));
  const qs = sp.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export default function DashboardPage() {
  const [selected, setSelected] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [symbol, setSymbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [hydrated, setHydrated] = useState(false);
  const [activeIndicatorIds, setActiveIndicatorIds] = useState<string[]>([]);

  const toggleIndicator = useCallback((id: string) => {
    setActiveIndicatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);
  const clearIndicators = useCallback(() => setActiveIndicatorIds([]), []);

  // Layout & workspace state (Phase 5).
  // Grid state: `gridCount` selects 1/2/4/6 panes; `gridTfs` is the
  // ordered list of timeframes filling the cells. Default cell 0
  // mirrors the user's currently-selected single-chart TF so the
  // grid feels connected to the single view.
  const [gridCount, setGridCount] = useState<GridCount>(DEFAULT_GRID_COUNT);
  const [gridTfs, setGridTfs] = useState<Timeframe[]>(tfsForCount(DEFAULT_GRID_COUNT, '15m'));
  const [searchOpen, setSearchOpen] = useState(false);

  // Change the grid count while preserving as many of the previous
  // cell TFs as fit. Persists to localStorage.
  const handleGridCountChange = useCallback((n: GridCount) => {
    setGridTfs((tfs) => reconcileGridTfs(tfs, n, selected));
    setGridCount(n);
  }, [selected]);

  // Hydrate the persisted grid once on the client. The share URL
  // does not capture grid state (only single-chart tf/type/symbol/
  // indicators), so localStorage is the sole source.
  useEffect(() => {
    const persisted = loadGrid();
    if (persisted) {
      setGridCount(persisted.count);
      setGridTfs(reconcileGridTfs(persisted.tfs, persisted.count, selected));
    }
    // We intentionally don't include `selected` in deps — we only
    // want the hydrate-once behavior. Subsequent selected changes
    // already trigger handleGridCountChange paths if relevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist on every change.
  useEffect(() => {
    saveGrid({ count: gridCount, tfs: gridTfs });
  }, [gridCount, gridTfs]);

  const applyWorkspace = useCallback((cfg: WorkspaceConfig) => {
    if (cfg.chartType === 'candlestick' || cfg.chartType === 'heikinAshi' || cfg.chartType === 'renko') {
      setChartType(cfg.chartType);
    }
    if (isCompareSymbol(cfg.symbol)) setSymbol(cfg.symbol);
    if ((TIMEFRAMES as string[]).includes(cfg.tf)) setSelected(cfg.tf as Timeframe);
    setActiveIndicatorIds(cfg.indicatorIds.filter((id) => CUSTOM_INDICATORS.some((d) => d.id === id)));
  }, []);
  const { activeIndicators, showVolume, toggleVolume, handleAdd: handleAddIndicator, handleRemove: handleRemoveIndicator, handleToggle: handleToggleIndicator, handleParam: handleParamChange } = useSharedIndicators();

  // Hydrate from the URL (tf, type, symbol) once on the client.
  useEffect(() => {
    const init = readInitialState();
    setSymbol(init.symbol);
    setSelected(init.tf);
    setChartType(init.type);
    // The share URL wins over localStorage so a shared link reproduces its stack.
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

  // Persist the indicator stack (after hydration so we don't clobber it).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(INDICATORS_KEY, JSON.stringify(activeIndicatorIds));
    } catch {}
  }, [hydrated, activeIndicatorIds]);

  // Sync TF + chart type + symbol to the URL for shareable links.
  useEffect(() => {
    if (!hydrated) return;
    writeUrlState(selected, chartType, symbol, activeIndicatorIds);
  }, [hydrated, selected, chartType, symbol, activeIndicatorIds]);

  // Keyboard shortcuts for TF + chart type only. Fullscreen (`F`) and
  // `Esc` are handled by ChartPanel itself so it can scope the
  // fullscreen target to the chart section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        setSearchOpen(true);
        e.preventDefault();
        return;
      }

      const idx = Number.parseInt(e.key, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= TIMEFRAMES.length) {
        setSelected(TIMEFRAMES[idx - 1]);
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'h') {
        setChartType('heikinAshi');
        e.preventDefault();
      } else if (k === 'c') {
        setChartType('candlestick');
        e.preventDefault();
      } else if (k === 'r') {
        setChartType('renko');
        e.preventDefault();
      } else if (k === 'g') {
        // Cycle through 1 -> 2 -> 4 -> 6 -> 1.
        const order: GridCount[] = [1, 2, 4, 6];
        const idx = order.indexOf(gridCount);
        const next = order[(idx + 1) % order.length];
        handleGridCountChange(next);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gridCount, handleGridCountChange]);

  // Historical fetch via TanStack Query.
  const klinesQueries = useQueries({
    queries: TIMEFRAMES.map((tf) => ({
      queryKey: klinesQueryKey(symbol, tf),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchKlinesTyped(tf, symbol, signal),
      staleTime: 5_000,
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: false,
      enabled: !!symbol,
      retry: (failureCount: number, err: unknown) => {
        if (err instanceof RateLimitedError) return false;
        if (err instanceof KlinesError && err.status >= 500) {
          return failureCount < 2;
        }
        return failureCount < 1;
      },
    })),
  });

  type CandlesByTf = Record<Timeframe, import('@/lib/types').Candle[]>;
  type ErrorsByTf = Record<Timeframe, string | null>;
  const [candlesByTf, setCandlesByTf] = useState<CandlesByTf>(
    () =>
      Object.fromEntries(
        TIMEFRAMES.map((tf) => [tf, [] as import('@/lib/types').Candle[]]),
      ) as CandlesByTf,
  );
  const [errorsByTf, setErrorsByTf] = useState<ErrorsByTf>(
    () =>
      Object.fromEntries(
        TIMEFRAMES.map((tf) => [tf, null]),
      ) as ErrorsByTf,
  );
  const [status, setStatus] = useState<'live' | 'demo' | 'loading'>('loading');
  const [wsStatus, setWsStatus] = useState<WSStatus>('closed');
  const [bookTicker, setBookTicker] = useState<BookTicker | null>(null);
  const wsBarCountRef = useRef(0);

  // Reconcile query state into the existing candlesByTf / errorsByTf
  // shape so the rest of the dashboard (WS merge, snapshot memos) is
  // unchanged. Depend on a stable per-query signature (status +
  // dataUpdatedAt + error message) instead of the queries array — the
  // array reference changes on every render and would re-run this
  // effect in a loop.
  const querySignature = klinesQueries
    .map((q) => {
      const err = q.error instanceof Error ? q.error.message : '';
      return `${q.status}:${q.dataUpdatedAt}:${q.isSuccess ? '1' : '0'}:${err}`;
    })
    .join('|');

  useEffect(() => {
    setCandlesByTf((prev) => {
      const next = { ...prev } as CandlesByTf;
      const nextErrors = Object.fromEntries(
        TIMEFRAMES.map((tf) => [tf, null]),
      ) as ErrorsByTf;
      let anyLive = false;
      let anyPending = false;

      for (let i = 0; i < TIMEFRAMES.length; i++) {
        const tf = TIMEFRAMES[i];
        const q = klinesQueries[i];
        if (q.isPending) {
          anyPending = true;
          continue;
        }
        if (q.isSuccess && q.data) {
          const incoming = q.data;
          const existing = prev[tf];
          // Preserve lazy-loaded older history that predates the refetched
          // latest page; otherwise the 30s poll would wipe scrolled-back bars.
          if (existing.length > 0 && incoming.length > 0 && existing[0].time < incoming[0].time) {
            const older = existing.filter((c) => c.time < incoming[0].time);
            next[tf] = [...older, ...incoming];
          } else {
            next[tf] = incoming;
          }
          anyLive = true;
          continue;
        }
        if (q.isError) {
          const msg = q.error instanceof Error ? q.error.message : 'fetch failed';
          nextErrors[tf] = msg;
          if (next[tf].length === 0) {
            const seed = 42 + TIMEFRAMES.indexOf(tf);
            next[tf] = synthCandles(500, seed);
          }
        }
      }

      setErrorsByTf(nextErrors);
      setStatus(anyLive ? 'live' : anyPending ? 'loading' : 'demo');
      let changed = false;
      for (const tf of TIMEFRAMES) {
        if (next[tf] !== prev[tf]) {
          changed = true;
          break;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySignature]);

  // WebSocket: subscribe to all 6 TF kline streams, merge into candlesByTf.
  useEffect(() => {
    const dispose = subscribeKlines(
      symbol,
      TIMEFRAMES,
      (bar, tf) => {
        wsBarCountRef.current += 1;
        // Reconcile paper positions against the new bar data.
        reconcileBar(bar);
        setCandlesByTf((prev) => {
          const next = { ...prev } as CandlesByTf;
          const arr = next[tf];
          if (!arr || arr.length === 0) return prev;
          const last = arr[arr.length - 1];
          if (bar.time === last.time) {
            const updated = arr.slice(0, -1);
            updated.push({
              ...last,
              open: bar.open,
              high: Math.max(last.high, bar.high),
              low: Math.min(last.low, bar.low),
              close: bar.close,
              volume: bar.volume,
            });
            next[tf] = updated;
          } else if (bar.time > last.time) {
            next[tf] = [...arr, bar];
          }
          return next;
        });
        setStatus((s) => (s === 'demo' ? 'live' : s));
      },
      setWsStatus,
    );
    return dispose;
  }, [symbol]);

  // Subscribe to real-time bid/ask via @bookTicker.
  useEffect(() => {
    const dispose = subscribeBookTicker(symbol, (ticker) => {
      setBookTicker(ticker);
    });
    return dispose;
  }, [symbol]);

  // Per-TF snapshots and prices.
  const { prices, changes, snapshots } = useMemo(() => {
    const prices = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, null]),
    ) as Record<Timeframe, number | null>;
    const changes = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, null]),
    ) as Record<Timeframe, number | null>;
    const snapshots = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, null]),
    ) as Record<Timeframe, TFSnapshot | null>;

    const now = Math.floor(Date.now() / 1000);
    for (const tf of TIMEFRAMES) {
      const arr = candlesByTf[tf];
      if (arr.length >= 2) {
        const last = arr[arr.length - 1].close;
        const first = arr[0].close;
        prices[tf] = last;
        changes[tf] = first === 0 ? 0 : ((last - first) / first) * 100;
      }
      snapshots[tf] = computeSignal(tf, arr, now);
    }
    return { prices, changes, snapshots };
  }, [candlesByTf]);

  const mood: MoodVerdict = useMemo(
    () => aggregateMood(TIMEFRAMES.map((tf) => snapshots[tf]).filter(Boolean) as TFSnapshot[]),
    [snapshots],
  );

  const indicatorRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; sub: string; cells: Record<string, 'buy' | 'sell' | 'neutral'> }> = [];
    for (const id of activeIndicatorIds) {
      const def = CUSTOM_INDICATORS.find((d) => d.id === id);
      if (!def) continue;

      const cells: Record<string, 'buy' | 'sell' | 'neutral'> = {};
      for (const tf of TIMEFRAMES) {
        const arr = candlesByTf[tf] as Candle[];
        if (!arr || arr.length === 0) {
          cells[tf] = 'neutral';
          continue;
        }
        const res = def.compute(arr);
        let lastSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
        for (let i = res.signals.length - 1; i >= 0; i--) {
          if (res.signals[i] !== 'neutral') {
            lastSignal = res.signals[i];
            break;
          }
        }
        cells[tf] = lastSignal;
      }

      rows.push({ key: def.id, label: def.name, sub: def.description, cells });
    }
    return rows;
  }, [candlesByTf, activeIndicatorIds]);

  const currentCandles = candlesByTf[selected];

  // ---- Jump-to-date: a focused historical window for the selected TF ----
  // When set, the chart shows this static window instead of the live stream.
  const [historyCandles, setHistoryCandles] = useState<import('@/lib/types').Candle[] | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const historyLoadingRef = useRef(false);

  // The window is tied to one TF + symbol; clear it if either changes.
  useEffect(() => {
    setHistoryCandles(null);
  }, [selected, symbol]);

  const jumpToDate = useCallback(
    async (dateMs: number) => {
      const tf = selected;
      // End the page a little after the target so it sits near the right edge.
      const endTime = dateMs + TF_MS[tf] * 30;
      try {
        const window = await fetchKlinesBefore(tf, symbol, endTime, 1000);
        if (window.length > 0) {
          setHistoryCandles(window);
          setFitSignal((n) => n + 1);
        }
      } catch {
        // ignore — leave the current view
      }
    },
    [selected, symbol],
  );

  const returnToLive = useCallback(() => {
    setHistoryCandles(null);
    setFitSignal((n) => n + 1);
  }, []);

  // ---- Lazy-load older history on scroll-to-left-edge ----
  const loadingOlderRef = useRef<Record<string, boolean>>({});
  const noMoreOlderRef = useRef<Record<string, boolean>>({});

  const loadOlder = useCallback(
    async (tf: Timeframe) => {
      const key = `${symbol}:${tf}`;
      if (loadingOlderRef.current[key] || noMoreOlderRef.current[key]) return;
      const arr = candlesByTf[tf];
      if (!arr || arr.length === 0) return;
      loadingOlderRef.current[key] = true;
      try {
        const beforeMs = arr[0].time * 1000;
        const older = await fetchKlinesBefore(tf, symbol, beforeMs, 1000);
        if (older.length === 0) {
          noMoreOlderRef.current[key] = true;
          return;
        }
        setCandlesByTf((prev) => {
          const cur = prev[tf];
          if (!cur || cur.length === 0) return prev;
          const cutoff = cur[0].time;
          const merged = older.filter((c) => c.time < cutoff);
          if (merged.length === 0) {
            noMoreOlderRef.current[key] = true;
            return prev;
          }
          return { ...prev, [tf]: [...merged, ...cur] };
        });
        // Fewer than a full page back = we've reached the start of history.
        if (older.length < 1000) noMoreOlderRef.current[key] = true;
      } catch {
        // Leave the guard cleared so a later scroll can retry.
      } finally {
        loadingOlderRef.current[key] = false;
      }
    },
    [candlesByTf, symbol],
  );

  // Extend the focused history window further back (scroll-left in jump view).
  const loadOlderHistory = useCallback(async () => {
    if (historyLoadingRef.current || !historyCandles || historyCandles.length === 0) return;
    historyLoadingRef.current = true;
    try {
      const older = await fetchKlinesBefore(selected, symbol, historyCandles[0].time * 1000, 1000);
      if (older.length > 0) {
        setHistoryCandles((prev) => {
          if (!prev || prev.length === 0) return prev;
          const merged = older.filter((c) => c.time < prev[0].time);
          return merged.length ? [...merged, ...prev] : prev;
        });
      }
    } catch {
      // ignore
    } finally {
      historyLoadingRef.current = false;
    }
  }, [historyCandles, selected, symbol]);

  const handleLoadOlder = useCallback(() => {
    if (historyCandles) loadOlderHistory();
    else loadOlder(selected);
  }, [historyCandles, loadOlderHistory, loadOlder, selected]);
  const currentPrice = prices[selected];
  const currentChange = changes[selected];

  const mid = useMemo(() => (currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].close : 0), [currentCandles]);
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;

  // Alert firing.
  const lastFiredSideRef = useRef<Record<string, AlertSide | null>>({});
  useEffect(() => {
    const rules = loadRules();
    if (rules.length === 0) return;
    const sigMap = Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, snapshots[tf]?.signal ?? null]),
    ) as Record<Timeframe, import('@/lib/types').Signal | null>;
    const toFire = rulesToFire(rules, sigMap, lastFiredSideRef.current);
    if (toFire.length === 0) return;
    for (const r of toFire) {
      const msg = `${symbol} · ${r.tf} flipped to ${r.side.toUpperCase()}`;
      console.info('[alert]', msg);
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('BTC Market Mood', { body: msg });
        } catch {
          // ignore
        }
      }
    }
    const updated = rules.map((r) =>
      toFire.find((f) => f.id === r.id)
        ? { ...r, lastFiredAt: Date.now() }
        : r,
    );
    saveRules(updated);
    const next: Record<string, AlertSide | null> = { ...lastFiredSideRef.current };
    for (const r of toFire) next[r.id] = r.side;
    lastFiredSideRef.current = next;
  }, [snapshots, symbol]);

  // Price-alert firing: watch the live mid and fire on level crossings.
  const prevPriceRef = useRef<number | null>(null);
  useEffect(() => {
    const last = bid != null && ask != null ? (bid + ask) / 2 : currentPrice;
    if (last == null || !Number.isFinite(last)) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = last;
    if (prev == null) return;
    const fired = priceAlertsToFire(getPriceAlerts(), symbol, prev, last);
    if (fired.length === 0) return;
    for (const a of fired) {
      const msg = `${symbol} crossed ${a.side} ${a.price}`;
      console.info('[price-alert]', msg);
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('BTC Market Mood', { body: msg });
        } catch {
          // ignore
        }
      }
    }
    markPriceAlertsFired(fired.map((a) => a.id));
  }, [bid, ask, currentPrice, symbol]);

  const [tab, setTab] = useState<'signals' | 'trade'>('signals');

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex w-full flex-1 flex-col gap-5 px-3 py-4 sm:px-4 sm:py-6">
        {/* Chart + right rail */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <WorkspaceMenu
                current={{ chartType, symbol, tf: selected, indicatorIds: activeIndicatorIds }}
                onApply={applyWorkspace}
              />
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-ink-faint sm:inline">
                  Press <Kbd>/</Kbd> to search · <Kbd>G</Kbd> grid
                </span>
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => setGridCount(1)}
                    aria-pressed={gridCount === 1}
                    title="Single chart"
                    className={[
                      'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border transition',
                      gridCount === 1
                        ? 'border-line-strong bg-surface-3 text-ink'
                        : 'border-line bg-surface-1 text-ink-faint hover:bg-surface-2 hover:text-ink',
                    ].join(' ')}
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                  <GridCountControl value={gridCount} onChange={handleGridCountChange} />
                </div>
              </div>
            </div>

            {gridCount > 1 ? (
              <MultiChartGrid
                count={gridCount}
                tfs={gridTfs}
                candlesByTf={candlesByTf}
                chartType={chartType}
                activeIndicatorIds={activeIndicatorIds}
                selected={selected}
                onSelectTf={(tf) => setSelected(tf)}
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
          </aside>
        </div>

        {/* Trade history + backtest stats (below the chart) */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <TradeHistory />
          <BacktestStats />
        </div>

        {/* Indicator management — full width */}
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

        {/* Backtest + alerts — full width */}
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
              {wsBarCountRef.current > 0 ? ` · ${wsBarCountRef.current} bars` : ''}
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-ink-muted">
      {children}
    </kbd>
  );
}

function DashboardAside({
  snapshots,
  timeframes,
  selected,
  onSelectTf,
  indicatorRows,
  symbol,
  midPrice,
  tab,
  onTabChange,
}: {
  snapshots: Record<Timeframe, TFSnapshot | null>;
  timeframes: Timeframe[];
  selected: Timeframe;
  onSelectTf: (tf: Timeframe) => void;
  indicatorRows: Array<{ key: string; label: string; sub: string; cells: Record<string, import('@/components/SignalMatrix').IndicatorCell> }>;
  symbol: CompareSymbol;
  midPrice: number;
  tab: 'signals' | 'trade';
  onTabChange: (t: 'signals' | 'trade') => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Tab bar */}
      <div className="flex rounded-lg border border-line bg-base/40 p-0.5">
        {(['signals', 'trade'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={[
              'flex-1 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition',
              tab === t ? 'bg-surface-2 text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            {t === 'signals' ? 'Signals' : 'Trade'}
          </button>
        ))}
      </div>

      {tab === 'signals' ? (
        <SignalMatrix
          snapshots={snapshots}
          timeframes={timeframes}
          selected={selected}
          onSelectTf={onSelectTf}
          indicatorRows={indicatorRows}
        />
      ) : (
        <TradingPanel symbol={symbol} midPrice={midPrice} />
      )}
    </div>
  );
}
