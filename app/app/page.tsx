'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import Header from '@/components/Header';
import dynamic from 'next/dynamic';
const ChartPanel = dynamic(() => import('@/components/ChartPanel'), { ssr: false });
import TimeframeStrip from '@/components/TimeframeStrip';
import MoodStrip from '@/components/MoodStrip';
import SignalMatrix from '@/components/SignalMatrix';
import AlertsPanel from '@/components/AlertsPanel';
import BacktestPanel from '@/components/BacktestPanel';
import IndicatorPicker from '@/components/trade/IndicatorPicker';
import OrderTicket from '@/components/trade/OrderTicket';
import { useSharedIndicators } from '@/lib/useSharedIndicators';
import { synthCandles } from '@/lib/binance';
import { fetchKlinesTyped, klinesQueryKey, KlinesError, RateLimitedError } from '@/lib/fetcher';
import { aggregateMood, computeSignal, type MoodVerdict, type TFSnapshot } from '@/lib/signals';
import { computeIndicator } from '@/lib/indicatorCompute';
import { INDICATORS } from '@/lib/indicatorLibrary';
import type { Candle } from '@/lib/types';
import { subscribeKlines, subscribeBookTicker, type BookTicker, type WSStatus } from '@/lib/ws';
import {
  DEFAULT_COMPARE_SYMBOL,
  type CompareSymbol,
  isCompareSymbol,
} from '@/lib/compare';
import { loadRules, rulesToFire, saveRules, type AlertSide } from '@/lib/alerts';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import type { ChartType } from '@/components/Chart';
import { usePaperStore, reconcileBar } from '@/lib/paperStore';
import { unrealizedPnl } from '@/lib/paper';
import type { ChartOverlay, OverlayKind } from '@/components/Chart';

const POLL_MS = 30000; // periodic reconciliation in case WS drops a bar

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
} {
  if (typeof window === 'undefined') {
    return { tf: '15m', type: 'candlestick', symbol: DEFAULT_COMPARE_SYMBOL };
  }
  const sp = new URLSearchParams(window.location.search);
  const tfParam = sp.get('tf');
  const symbolParam = sp.get('symbol') ?? DEFAULT_COMPARE_SYMBOL;
  const tf: Timeframe = (TIMEFRAMES as string[]).includes(tfParam ?? '') ? (tfParam as Timeframe) : '15m';
  const type: ChartType = parseChartType(sp.get('type')) ?? 'candlestick';
  const symbol: CompareSymbol = isCompareSymbol(symbolParam) ? symbolParam : DEFAULT_COMPARE_SYMBOL;
  return { tf, type, symbol };
}

function writeUrlState(tf: Timeframe, type: ChartType, symbol: CompareSymbol) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  if (tf === '15m') sp.delete('tf'); else sp.set('tf', tf);
  if (type === 'candlestick') sp.delete('type');
  else sp.set('type', type === 'heikinAshi' ? 'ha' : type === 'renko' ? 'renko' : 'candle');
  if (symbol === DEFAULT_COMPARE_SYMBOL) sp.delete('symbol');
  else sp.set('symbol', symbol);
  const qs = sp.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export default function DashboardPage() {
  const [selected, setSelected] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [symbol, setSymbol] = useState<CompareSymbol>(DEFAULT_COMPARE_SYMBOL);
  const [hydrated, setHydrated] = useState(false);
  const { activeIndicators, showVolume, toggleVolume, handleAdd: handleAddIndicator, handleRemove: handleRemoveIndicator, handleToggle: handleToggleIndicator, handleParam: handleParamChange } = useSharedIndicators();

  // Hydrate from the URL (tf, type, symbol) once on the client.
  useEffect(() => {
    const init = readInitialState();
    setSymbol(init.symbol);
    setSelected(init.tf);
    setChartType(init.type);
    setHydrated(true);
  }, []);

  // Sync TF + chart type + symbol to the URL for shareable links.
  useEffect(() => {
    if (!hydrated) return;
    writeUrlState(selected, chartType, symbol);
  }, [hydrated, selected, chartType, symbol]);

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          next[tf] = q.data;
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

  // Per-TF indicator directions for the SignalMatrix.
  // Runs computeIndicator for each active indicator × timeframe and
  // derives a buy/sell/neutral direction from the last non-null value.
  type IndicatorCell = 'buy' | 'sell' | 'neutral';
  const indicatorRows = useMemo(() => {
    const lookup = new Map(INDICATORS.map((d) => [d.id, d]));
    return activeIndicators
      .filter((a) => a.visible)
      .map((a) => {
        const def = lookup.get(a.id);
        if (!def) return null;
        const cells: Record<string, IndicatorCell> = {};

        for (const tf of TIMEFRAMES) {
          const arr = candlesByTf[tf] as Candle[];
          if (!arr || arr.length < 30) {
            cells[tf] = 'neutral';
            continue;
          }
          try {
            const result = computeIndicator(def, arr, a.params);
            // Direction heuristic: for oscillators (RSI, Stoch, MFI, etc.)
            // we use the last line value + overbought/oversold-style thresholds.
            // For trend indicators (EMA cross, MACD) we check line relationships.
            const mainLine = result.lines[0];
            if (!mainLine || mainLine.values.length === 0) {
              cells[tf] = 'neutral';
              continue;
            }
            let lastVal: number | null = null;
            for (let j = mainLine.values.length - 1; j >= 0; j--) {
              if (mainLine.values[j] != null) { lastVal = mainLine.values[j]; break; }
            }
            if (lastVal == null) { cells[tf] = 'neutral'; continue; }

            let dir: IndicatorCell = 'neutral';
            // Oscillators: over 70 = sell, under 30 = buy
            if (['rsi', 'stoch', 'mfi', 'willr', 'cci'].includes(a.id) ||
                (def.category === 'momentum' && def.separatePane)) {
              dir = lastVal >= 70 ? 'sell' : lastVal <= 30 ? 'buy' : 'neutral';
            } else if (result.lines.length >= 2) {
              // Two-line indicators: first line > second = bullish
              const secondLine = result.lines[1];
              let sVal: number | null = null;
              for (let j = secondLine.values.length - 1; j >= 0; j--) {
                if (secondLine.values[j] != null) { sVal = secondLine.values[j]; break; }
              }
              if (sVal != null) {
                dir = lastVal > sVal ? 'buy' : lastVal < sVal ? 'sell' : 'neutral';
              }
            } else if (result.lines.length === 1) {
              // Single-line: above middle of range = bullish (simplified)
              dir = lastVal > 50 ? 'buy' : lastVal < 50 ? 'sell' : 'neutral';
            }
            cells[tf] = dir;
          } catch {
            cells[tf] = 'neutral';
          }
        }

        return {
          key: a.instanceId,
          label: def.label,
          sub: def.params.map((pk) => `${pk.label} ${a.params[pk.key] ?? pk.default}`).join(', '),
          cells,
        };
      })
      .filter(Boolean) as Array<{ key: string; label: string; sub: string; cells: Record<string, IndicatorCell> }>;
  }, [activeIndicators, candlesByTf]);

  const currentCandles = candlesByTf[selected];
  const currentPrice = prices[selected];
  const currentChange = changes[selected];

  // Paper trading state (shared with /trade page)
  const paper = usePaperStore();
  const pos = paper.positions[symbol] ?? null;
  const hasPosition = !!(pos && pos.side !== 'flat' && pos.units > 0);
  const mid = useMemo(() => (currentCandles.length > 0 ? currentCandles[currentCandles.length - 1].close : 0), [currentCandles]);
  const bid = bookTicker?.bid ?? null;
  const ask = bookTicker?.ask ?? null;
  const upnl = useMemo(() => unrealizedPnl(pos, mid), [pos, mid]);

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

  const [tab, setTab] = useState<'signals' | 'trade'>('signals');

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex w-full flex-1 flex-col gap-5 px-3 py-4 sm:px-4 sm:py-6">
        {/* Chart + right rail */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <ChartPanel
              candles={currentCandles}
              type={chartType}
              onTypeChange={setChartType}
              selected={selected}
              onSelectTf={setSelected}
              symbol={symbol}
              price={currentPrice}
              change={currentChange}
              status={status}
              hideIndicators={false}
              showVolume={showVolume}
              onQuickTrade={() => setTab('trade')}
              bid={bid}
              ask={ask}
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
              hasPosition={!!hasPosition}
              pos={pos}
              upnl={upnl}
              tab={tab}
              onTabChange={setTab}
            />
          </aside>
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

      <footer className="border-t border-line bg-base/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-3 py-4 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span>
            Educational use only, not financial advice. Live data via Binance
            WebSocket; periodic reconciliation every {POLL_MS / 1000}s.
          </span>
          <span className="flex items-center gap-3">
            <span className="hidden items-center gap-1 md:inline-flex">
              <Kbd>1</Kbd>…<Kbd>6</Kbd> timeframe · <Kbd>H</Kbd> Heikin · <Kbd>C</Kbd> candles · <Kbd>R</Kbd> renko · <Kbd>F</Kbd> full
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
  hasPosition,
  pos,
  upnl,
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
  hasPosition: boolean;
  pos: ReturnType<typeof usePaperStore>['positions'][string];
  upnl: number;
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
        <div className="flex flex-col gap-3">
          <OrderTicket
            symbol={symbol}
            midPrice={midPrice}
            leverage={10}
            onLeverageChange={() => {}}
            reduceAvailable={hasPosition && pos ? pos.units : 0}
          />
          {hasPosition && pos && (
            <MiniPosition pos={pos} midPrice={midPrice} upnl={upnl} />
          )}
        </div>
      )}
    </div>
  );
}



function MiniPosition({
  pos,
  midPrice,
  upnl,
}: {
  pos: NonNullable<ReturnType<typeof usePaperStore>['positions'][string]>;
  midPrice: number;
  upnl: number;
}) {
  const paper = usePaperStore();
  const upnlPct = pos.entryPrice > 0 ? ((midPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'long' ? 1 : -1) : 0;

  return (
    <div className="panel rounded-xl p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
        Open Position
      </h3>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-ink-faint">Side</span>
          <span className={pos.side === 'long' ? 'text-bull-bright font-medium' : 'text-bear-bright font-medium'}>
            {pos.side.toUpperCase()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Size</span>
          <span className="text-ink font-mono">{pos.units} BTC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Entry</span>
          <span className="text-ink font-mono">{pos.entryPrice.toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Mark</span>
          <span className="text-ink font-mono">{midPrice.toFixed(0)}</span>
        </div>
        {pos.tp != null && (
          <div className="flex justify-between">
            <span className="text-ink-faint">TP</span>
            <span className="text-bull-bright font-mono">{pos.tp.toFixed(0)}</span>
          </div>
        )}
        {pos.sl != null && (
          <div className="flex justify-between">
            <span className="text-ink-faint">SL</span>
            <span className="text-bear-bright font-mono">{pos.sl.toFixed(0)}</span>
          </div>
        )}
        <div className="mt-2 border-t border-line pt-2 flex justify-between">
          <span className="text-ink-faint">uPNL</span>
          <span className={['font-mono font-medium', upnl >= 0 ? 'text-bull-bright' : 'text-bear-bright'].join(' ')}>
            {upnl >= 0 ? '+' : ''}{upnl.toFixed(2)} ({upnlPct >= 0 ? '+' : ''}{upnlPct.toFixed(2)}%)
          </span>
        </div>
        <button
          onClick={() => paper.closePosition(midPrice, pos.symbol)}
          className="mt-2 w-full rounded bg-surface-2 py-1 text-xs text-ink-muted hover:text-bear-bright transition"
        >
          Close Position
        </button>
      </div>
    </div>
  );
}

function MarketSnapshotPlaceholder() {
  return (
    <section className="rounded-2xl border border-line bg-surface-1/40 p-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
        Market snapshot
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Quick stats land here once a widget is wired up.
      </p>
    </section>
  );
}
