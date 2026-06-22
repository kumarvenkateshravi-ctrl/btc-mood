'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { synthCandles } from '../binance';
import {
  fetchKlinesTyped,
  fetchKlinesBefore,
  klinesQueryKey,
  KlinesError,
  RateLimitedError,
} from '../fetcher';
import { subscribeKlines, subscribeBookTicker, type BookTicker, type WSStatus } from '../ws';
import { reconcileBar } from '../paperStore';
import { POLL_MS } from '../dashboardUrl';
import type { CompareSymbol } from '../compare';

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

export interface MarketData {
  candlesByTf: CandlesByTf;
  setCandlesByTf: React.Dispatch<React.SetStateAction<CandlesByTf>>;
  errorsByTf: ErrorsByTf;
  status: 'live' | 'demo' | 'loading';
  wsStatus: WSStatus;
  bookTicker: BookTicker | null;
  wsBarCount: number;
  /** Lazy-load older history for a TF (scroll-to-left-edge). */
  loadOlder: (tf: Timeframe) => Promise<void>;
}

/**
 * Owns the entire market-data pipeline for the dashboard:
 *   - TanStack Query historical fetch (6 TFs, 30s poll)
 *   - Query → candlesByTf reconciliation (preserves lazy-loaded bars)
 *   - Binance WS kline subscription (live bar merge)
 *   - Binance WS bookTicker subscription (bid/ask)
 *   - Lazy-load older history on scroll-left
 *
 * Returns the candle state + setters so the history-window hook can
 * extend the same arrays.
 */
export function useMarketData(symbol: CompareSymbol): MarketData {
  const [candlesByTf, setCandlesByTf] = useState<CandlesByTf>(emptyCandles);
  const [errorsByTf, setErrorsByTf] = useState<ErrorsByTf>(emptyErrors);
  const [status, setStatus] = useState<'live' | 'demo' | 'loading'>('loading');
  const [wsStatus, setWsStatus] = useState<WSStatus>('closed');
  const [bookTicker, setBookTicker] = useState<BookTicker | null>(null);
  const wsBarCountRef = useRef(0);

  // ---- Historical fetch via TanStack Query ----
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
    setCandlesByTf((prev) => {
      const next = { ...prev } as CandlesByTf;
      const nextErrors = emptyErrors();
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

  // ---- WebSocket: kline streams for all 6 TFs ----
  useEffect(() => {
    const dispose = subscribeKlines(
      symbol,
      TIMEFRAMES,
      (bar, tf) => {
        wsBarCountRef.current += 1;
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

  // ---- WebSocket: bookTicker for real-time bid/ask ----
  useEffect(() => {
    const dispose = subscribeBookTicker(symbol, (ticker) => {
      setBookTicker(ticker);
    });
    return dispose;
  }, [symbol]);

  // ---- Lazy-load older history ----
  const loadingOlderRef = useRef<Record<string, boolean>>({});
  const noMoreOlderRef = useRef<Record<string, boolean>>({});

  const loadOlder = async (tf: Timeframe) => {
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
      if (older.length < 1000) noMoreOlderRef.current[key] = true;
    } catch {
      // Leave the guard cleared so a later scroll can retry.
    } finally {
      loadingOlderRef.current[key] = false;
    }
  };

  return {
    candlesByTf,
    setCandlesByTf,
    errorsByTf,
    status,
    wsStatus,
    bookTicker,
    wsBarCount: wsBarCountRef.current,
    loadOlder,
  };
}
