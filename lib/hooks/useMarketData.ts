'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import {
  fetchKlinesTyped,
  fetchKlinesBefore,
  klinesQueryKey,
  KlinesError,
  RateLimitedError,
} from '../fetcher';
import { subscribeKlines, subscribeBookTicker, type BookTicker, type WSStatus } from '../ws';
import { reconcileLiveTick } from '../paperStore';
import { POLL_MS } from '../dashboardUrl';
import type { CompareSymbol } from '../compare';
import { HistoricalRequestGate, type HistoricalRequest } from '../historicalRequestIdentity';
import { deriveMarketDataIntegrity, type MarketDataIntegrity } from '../marketDataIntegrity';
import { setMarketDataIntegrity } from '../marketDataTrust';

type CandlesByTf = Record<Timeframe, Candle[]>;
type ErrorsByTf = Record<Timeframe, string | null>;

function emptyCandles(): CandlesByTf {
  return Object.fromEntries(
    TIMEFRAMES.map((tf) => [tf, [] as Candle[]]),
  ) as CandlesByTf;
}
function emptyErrors(): ErrorsByTf {
  return Object.fromEntries(TIMEFRAMES.map((tf) => [tf, null])) as ErrorsByTf;
}

function linkAbortSignal(request: HistoricalRequest, signal?: AbortSignal) {
  if (!signal) return () => {};
  const abort = () => request.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface MarketData {
  candlesByTf: CandlesByTf;
  setCandlesByTf: React.Dispatch<React.SetStateAction<CandlesByTf>>;
  errorsByTf: ErrorsByTf;
  status: 'live' | 'demo' | 'loading';
  integrity: MarketDataIntegrity;
  wsStatus: WSStatus;
  bookTicker: BookTicker | null;
  ticker24h: { price: number; change: number; changeAbs: number; volume: number } | null;
  wsBarCount: number;
  lastUpdateMs: number;
  /** Lazy-load older history for a TF (scroll-to-left-edge). */
  loadOlder: (tf: Timeframe) => Promise<void>;
  loadHistoryUntil: (
    tf: Timeframe,
    untilMs: number,
    maxPages: number,
    onProgress?: (p: { tf: Timeframe; pages: number; oldestMs: number }) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}

/**
 * Owns the entire market-data pipeline for the dashboard:
 *   - TanStack Query historical fetch (6 TFs, 30s poll)
 *   - Query → candlesByTf reconciliation (preserves lazy-loaded bars)
 *   - Binance WS kline subscription (live bar merge)
 *   - Binance WS bookTicker subscription (bid/ask)
 *   - Binance WS ticker subscription (24hr price/change)
 *   - Lazy-load older history on scroll-left
 *
 * Returns the candle state + setters so the history-window hook can
 * extend the same arrays.
 */
export function useMarketData(symbol: CompareSymbol): MarketData {
  const [candlesByTf, setCandlesByTf] = useState<CandlesByTf>(emptyCandles);
  const [errorsByTf, setErrorsByTf] = useState<ErrorsByTf>(emptyErrors);
  const [status, setStatus] = useState<'live' | 'demo' | 'loading'>('loading');
  const [integrity, setIntegrity] = useState<MarketDataIntegrity>('loading');
  const [integrityRefresh, setIntegrityRefresh] = useState(0);
  const [wsStatus, setWsStatus] = useState<WSStatus>('closed');
  const [bookTicker, setBookTicker] = useState<BookTicker | null>(null);
  const [ticker24h, setTicker24h] = useState<{ price: number; change: number; changeAbs: number; volume: number } | null>(null);
  const [lastUpdateMs, setLastUpdateMs] = useState<number>(0);
  const wsBarCountRef = useRef(0);

  const historicalGateRef = useRef(new HistoricalRequestGate());
  const requestContextRef = useRef({ symbol, generation: 0 });
  const loadingOlderRef = useRef<Record<string, number>>({});
  const noMoreOlderRef = useRef<Record<string, boolean>>({});
  if (requestContextRef.current.symbol !== symbol) {
    requestContextRef.current = {
      symbol,
      generation: requestContextRef.current.generation + 1,
    };
    historicalGateRef.current.invalidate();
    loadingOlderRef.current = {};
    setMarketDataIntegrity('loading');
  }

  // Clear all candle state the instant the symbol changes. Without this the
  // previous symbol's bars linger for the ~200ms until the new REST fetch
  // lands — and because two symbols on the same timeframe share identical bar
  // timestamps + count, the chart mistakes the stale bars for in-bar ticks and
  // never fully repaints (BTC candles + BTC price scale on an ETH chart). An
  // empty array gives the chart an unambiguous "new load" it can't misread.
  const prevSymbolRef = useRef(symbol);
  useEffect(() => {
    if (prevSymbolRef.current === symbol) return;
    prevSymbolRef.current = symbol;
    setCandlesByTf(emptyCandles());
    setErrorsByTf(emptyErrors());
    setBookTicker(null);
    setLastUpdateMs(0);
    setStatus('loading');
    setIntegrity('loading');
    setMarketDataIntegrity('loading');
  }, [symbol]);

  // ---- Historical fetch via TanStack Query ----

  useEffect(() => () => historicalGateRef.current.invalidate(), []);
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

  // Reconcile query state into candlesByTf / errorsByTf. Depend on a
  // stable per-query signature instead of the queries array reference.
  const querySignature = klinesQueries
    .map((q) => {
      const err = q.error instanceof Error ? q.error.message : '';
      return `${q.status}:${q.dataUpdatedAt}:${q.isSuccess ? '1' : '0'}:${err}`;
    })
    .join('|');

  useEffect(() => {
    const requestContext = requestContextRef.current;
    const isCurrentContext = () => requestContext === requestContextRef.current;
    if (!isCurrentContext()) return;

    setCandlesByTf((prev) => {
      if (!isCurrentContext()) return prev;
      const next = { ...prev } as CandlesByTf;
      const nextErrors = emptyErrors();
      let anyLive = false;

      for (let i = 0; i < TIMEFRAMES.length; i++) {
        const tf = TIMEFRAMES[i];
        const q = klinesQueries[i];
        if (q.isPending) continue;
        if (q.isSuccess && q.data) {
          const incoming = q.data;
          const existing = prev[tf];
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
        }
      }

      if (!isCurrentContext()) return prev;
      setErrorsByTf(nextErrors);
      setStatus(anyLive ? 'live' : 'loading');
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
  }, [querySignature, symbol]);

  // ---- WebSocket: kline streams for all 6 TFs ----
  useEffect(() => {
    const dispose = subscribeKlines(
      symbol,
      TIMEFRAMES,
      (bar, tf) => {
        wsBarCountRef.current += 1;
        // Reconcile paper positions against the price MOVEMENT (tick close),
        // never the forming candle's accumulated high/low — the latter closed
        // fresh positions instantly (esp. via the daily candle's full range).
        reconcileLiveTick(symbol, bar.close, bar.time);
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
        setLastUpdateMs(Date.now());
      },
      setWsStatus,
    );
    return dispose;
  }, [symbol]);

  // Re-evaluate exactly when a fresh live tick becomes stale; avoid a periodic
  // dashboard re-render while still guaranteeing stale data cannot trade.
  useEffect(() => {
    if (wsStatus !== 'open' || lastUpdateMs <= 0) return;
    const delay = Math.max(0, lastUpdateMs + 15_000 - Date.now());
    const timeout = window.setTimeout(() => setIntegrityRefresh((n) => n + 1), delay + 1);
    return () => window.clearTimeout(timeout);
  }, [wsStatus, lastUpdateMs]);

  // Production candles retain their exchange provenance. A transient REST or
  // socket failure keeps prior validated bars, but downgrades their integrity
  // instead of fabricating replacement data.
  useEffect(() => {
    const next = deriveMarketDataIntegrity({
      hasAnyCandles: TIMEFRAMES.some((tf) => candlesByTf[tf].length > 0),
      hasAllTimeframes: TIMEFRAMES.every((tf) => candlesByTf[tf].length > 0),
      hasErrors: TIMEFRAMES.some((tf) => errorsByTf[tf] != null),
      isLoading: klinesQueries.some((q) => q.isPending),
      wsStatus,
      lastUpdateMs,
      nowMs: Date.now(),
    });
    setIntegrity(next);
    setMarketDataIntegrity(next);
    setStatus(next === 'live' ? 'live' : 'loading');
  }, [candlesByTf, errorsByTf, querySignature, wsStatus, lastUpdateMs, integrityRefresh]);

  // ---- WebSocket: bookTicker for real-time bid/ask ----
  useEffect(() => {
    const dispose = subscribeBookTicker(symbol, (ticker) => {
      setBookTicker(ticker);
      setLastUpdateMs(Date.now());
    });
    return dispose;
  }, [symbol]);

  // ---- Lazy-load older history ----

  // Fetch ONE page older than `beforeMs`, prepend it, and return the new
  // oldest ms (or null when history is exhausted). The `before` cursor is
  // tracked locally by callers — state updates are async, so reading
  // candlesByTf inside a loop would see stale values.
  const fetchAndPrependPage = async (
    tf: Timeframe,
    beforeMs: number,
    request: HistoricalRequest,
  ): Promise<number | null> => {
    const requestSymbol = request.identity.symbol as CompareSymbol;
    const key = `${requestSymbol}:${tf}`;
    const older = await fetchKlinesBefore(tf, requestSymbol, beforeMs, 1000, request.signal);
    if (!request.isCurrent()) return null;
    if (older.length === 0) {
      noMoreOlderRef.current[key] = true;
      return null;
    }
    setCandlesByTf((prev) => {
      if (!request.isCurrent()) return prev;
      const cur = prev[tf];
      if (!cur || cur.length === 0) return prev;
      const cutoff = cur[0].time;
      const merged = older.filter((c) => c.time < cutoff);
      if (merged.length === 0) return prev;
      return { ...prev, [tf]: [...merged, ...cur] };
    });
    if (older.length < 1000) {
      noMoreOlderRef.current[key] = true;
      return null;
    }
    return older[0].time * 1000;
  };

  // Scroll-triggered lazy load: chase up to 3 pages per trigger so browsing
  // left feels bottomless instead of one 1000-bar hop per gesture. The pages
  // are merged in ONE state update — three separate prepends meant three
  // full indicator recomputes + chart repaints per gesture, which is what
  // made heavy indicators (SMC) hitch during zoom-out.
  const loadOlder = async (tf: Timeframe) => {
    const key = `${symbol}:${tf}`;
    if (loadingOlderRef.current[key] || noMoreOlderRef.current[key]) return;
    const arr = candlesByTf[tf];
    if (!arr || arr.length === 0) return;
    const request = historicalGateRef.current.begin(symbol, tf, 'lazy');
    loadingOlderRef.current[key] = request.identity.requestId;
    try {
      let before = arr[0].time * 1000;
      const chunks: Candle[][] = []; // newest chunk first
      for (let page = 0; page < 3; page++) {
        const older = await fetchKlinesBefore(tf, symbol, before, 1000, request.signal);
        if (!request.isCurrent()) return;
        if (older.length === 0) {
          noMoreOlderRef.current[key] = true;
          break;
        }
        chunks.push(older);
        before = older[0].time * 1000;
        if (older.length < 1000) {
          noMoreOlderRef.current[key] = true;
          break;
        }
      }
      if (chunks.length === 0) return;
      const olderAll = chunks.reverse().flat(); // oldest -> newest
      setCandlesByTf((prev) => {
        if (!request.isCurrent()) return prev;
        const cur = prev[tf];
        if (!cur || cur.length === 0) return prev;
        const cutoff = cur[0].time;
        const merged = olderAll.filter((c) => c.time < cutoff);
        if (merged.length === 0) {
          noMoreOlderRef.current[key] = true;
          return prev;
        }
        return { ...prev, [tf]: [...merged, ...cur] };
      });
    } catch {
      // Leave the guard cleared so a later scroll can retry.
    } finally {
      if (loadingOlderRef.current[key] === request.identity.requestId) {
        delete loadingOlderRef.current[key];
      }
      request.finish();
    }
  };

  /**
   * Deep backfill for Bar Replay practice: page history until it covers
   * `untilMs` (or maxPages / exhaustion). Throttled to stay far below the
   * API rate limit. Reports progress after every page.
   */
  const loadHistoryUntil = async (
    tf: Timeframe,
    untilMs: number,
    maxPages: number,
    onProgress?: (p: { tf: Timeframe; pages: number; oldestMs: number }) => void,
    signal?: AbortSignal,
  ) => {
    const key = `${symbol}:${tf}`;
    // A deliberate deep backfill supersedes an older lazy request for this book.
    const arr = candlesByTf[tf];
    if (!arr || arr.length === 0) return;
    const request = historicalGateRef.current.begin(symbol, tf, 'deep');
    const unlinkAbort = linkAbortSignal(request, signal);
    if (!request.isCurrent()) {
      unlinkAbort();
      request.finish();
      return;
    }
    loadingOlderRef.current[key] = request.identity.requestId;
    try {
      let before: number | null = arr[0].time * 1000;
      for (let page = 0; page < maxPages; page++) {
        if (!request.isCurrent() || before == null || before <= untilMs || noMoreOlderRef.current[key]) break;
        before = await fetchAndPrependPage(tf, before, request);
        if (!request.isCurrent()) return;
        if (before != null) {
          request.ifCurrent(() => onProgress?.({ tf, pages: page + 1, oldestMs: before! }));
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (error) {
      if (!isAbortError(error) && request.isCurrent()) {
        // Partial history is still useful; the caller proceeds with whatever loaded.
      }
    } finally {
      if (loadingOlderRef.current[key] === request.identity.requestId) {
        delete loadingOlderRef.current[key];
      }
      unlinkAbort();
      request.finish();
    }
  };

  // ---- WebSocket: ticker for 24hr live price/change ----
  useEffect(() => {
    let active = true;

    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
      .then((res) => res.json())
      .then((data) => {
        if (active && data && data.lastPrice) {
          setTicker24h({
            price: Number(data.lastPrice),
            change: Number(data.priceChangePercent),
            changeAbs: Number(data.priceChange),
            volume: Number(data.volume),
          });
        }
      })
      .catch(console.error);

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    ws.onmessage = (event) => {
      if (!active) return;
      try {
        const data = JSON.parse(event.data);
        if (data.c && data.P) {
          setTicker24h({
            price: Number(data.c),
            change: Number(data.P),
            changeAbs: Number(data.p),
            volume: Number(data.v),
          });
          setLastUpdateMs(Date.now());
        }
      } catch (e) {}
    };

    return () => {
      active = false;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        try { ws.close(); } catch (e) {}
      }
    };
  }, [symbol]);

  return {
    candlesByTf,
    setCandlesByTf,
    errorsByTf,
    status,
    integrity,
    wsStatus,
    bookTicker,
    ticker24h,
    wsBarCount: wsBarCountRef.current,
    lastUpdateMs,
    loadOlder,
    loadHistoryUntil,
  };
}
