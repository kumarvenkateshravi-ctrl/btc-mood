'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import {
  fetchKlinesTyped,
  fetchKlinesBefore,
  fetchKlinesRange,
  klinesQueryKey,
  KlinesError,
  RateLimitedError,
} from '../fetcher';
import { recoverMarketDataTransports, suspendMarketDataTransports, subscribeKlines, subscribeBookTicker, subscribeTicker, type BookTicker, type KlineEventMeta, type WSStatus } from '../ws';
import { reconcileLiveTick } from '../paperStore';
import { POLL_MS } from '../dashboardUrl';
import type { CompareSymbol } from '../compare';
import { HistoricalRequestGate, type HistoricalRequest } from '../historicalRequestIdentity';
import { deriveMarketDataIntegrity, type MarketDataIntegrity } from '../marketDataIntegrity';
import { setMarketDataIntegrity } from '../marketDataTrust';
import { createLatestFrameQueue, type LatestFrameQueue } from './marketDataBatching';
import {
  createFeedHealthSnapshot,
  markFeedMessage,
  markFeedRepaired,
  markFeedSynchronizing,
  markFeedTransport,
  refreshFeedHealth,
  summarizeFeedHealth,
  type FeedHealthSnapshot,
} from '../marketData/feedHealth';
import {
  acceptWebSocketCandle,
  createCandleMergeState,
  mergeRestCandles,
  setCandleMergeEpoch,
  type CandleGap,
  type CandleMergeState,
} from '../marketData/candleMerge';
import { applyValidatedGapRepair, planGapRepair } from '../marketData/gapRepair';
import { BackoffRetry, bindBrowserLifecycleRecovery, MarketDataRecoveryCoordinator } from '../marketData/recovery';

type CandlesByTf = Record<Timeframe, Candle[]>;
type ErrorsByTf = Record<Timeframe, string | null>;
type CandleGapsByTf = Record<Timeframe, CandleGap | null>;

type BufferedKlineEvent = { bar: Candle; meta: KlineEventMeta };
type GapRepairTask = {
  gap: CandleGap;
  epoch: number;
  request: HistoricalRequest | null;
  status: 'queued' | 'repairing' | 'failed';
  buffered: BufferedKlineEvent[];
  overflowed: boolean;
  retry: BackoffRetry | null;
  contextGeneration: number;
};
type GapRepairsByTf = Record<Timeframe, GapRepairTask | null>;
const MAX_BUFFERED_GAP_EVENTS = 2_000;

function emptyCandles(): CandlesByTf {
  return Object.fromEntries(
    TIMEFRAMES.map((tf) => [tf, [] as Candle[]]),
  ) as CandlesByTf;
}
function emptyErrors(): ErrorsByTf {
  return Object.fromEntries(TIMEFRAMES.map((tf) => [tf, null])) as ErrorsByTf;
}
function emptyCandleGaps(): CandleGapsByTf {
  return Object.fromEntries(TIMEFRAMES.map((tf) => [tf, null])) as CandleGapsByTf;
}
function createCandleMergeStates(symbol: string): Record<Timeframe, CandleMergeState> {
  return Object.fromEntries(TIMEFRAMES.map((tf) => [tf, createCandleMergeState({ symbol, timeframe: tf })])) as Record<Timeframe, CandleMergeState>;
}
function emptyGapRepairs(): GapRepairsByTf {
  return Object.fromEntries(TIMEFRAMES.map((tf) => [tf, null])) as GapRepairsByTf;
}
function sameCandleGap(left: CandleGap | null, right: CandleGap): boolean {
  return left != null && left.fromOpenTime === right.fromOpenTime
    && left.toOpenTime === right.toOpenTime
    && left.missingIntervals === right.missingIntervals;
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

function feedHealthSignature(snapshot: FeedHealthSnapshot): string {
  return Object.values(snapshot.feeds)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((feed) => `${feed.key}:${feed.connectionEpoch}:${feed.transport}:${feed.synchronization}:${feed.state}`)
    .join('|');
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
  /** Latest validated kline update only; quote ticks intentionally do not refresh it. */
  lastUpdateMs: number;
  feedHealth: FeedHealthSnapshot;
  /** Detected timestamp discontinuities. Repair is deliberately deferred to Stage 3 Task 5. */
  candleGaps: CandleGapsByTf;
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
  const [gapRepairTick, setGapRepairTick] = useState(0);
  const [wsStatus, setWsStatus] = useState<WSStatus>('closed');
  const [bookTicker, setBookTicker] = useState<BookTicker | null>(null);
  const [ticker24h, setTicker24h] = useState<{ price: number; change: number; changeAbs: number; volume: number } | null>(null);
  const [lastUpdateMs, setLastUpdateMs] = useState<number>(0);
  const [feedHealth, setFeedHealth] = useState<FeedHealthSnapshot>(() => createFeedHealthSnapshot(symbol));
  const [candleGaps, setCandleGaps] = useState<CandleGapsByTf>(emptyCandleGaps);
  const feedHealthRef = useRef<FeedHealthSnapshot>(feedHealth);
  const wsBarCountRef = useRef(0);
  const latestCandleByTfRef = useRef<CandlesByTf>(emptyCandles());
  const candleMergeRef = useRef<Record<Timeframe, CandleMergeState>>(createCandleMergeStates(symbol));
  const gapRepairsRef = useRef<GapRepairsByTf>(emptyGapRepairs());
  const recoveryCoordinatorRef = useRef<MarketDataRecoveryCoordinator | null>(null);
  const offlineRef = useRef(false);
  const applyFeedHealth = useCallback((update: (current: FeedHealthSnapshot) => FeedHealthSnapshot) => {
    const previous = feedHealthRef.current;
    const next = update(previous);
    if (next === previous) return;
    feedHealthRef.current = next;
    if (feedHealthSignature(previous) !== feedHealthSignature(next)) setFeedHealth(next);
  }, []);
  const [formingQueue] = useState<LatestFrameQueue<Candle>>(() => createLatestFrameQueue<Candle>((updates) => {
    setCandlesByTf((prev) => {
      let next = prev;
      for (const [key, bar] of Object.entries(updates)) {
        const tf = key as Timeframe;
        const arr = prev[tf];
        if (!arr || arr.length === 0) continue;
        const last = arr[arr.length - 1];
        if (bar.time < last.time) continue;
        const merged = bar.time === last.time
          ? { ...last, ...bar, high: Math.max(last.high, bar.high), low: Math.min(last.low, bar.low) }
          : bar;
        next = { ...next, [tf]: bar.time === last.time ? [...arr.slice(0, -1), merged] : [...arr, merged] };
      }
      return next === prev ? prev : next;
    });
    setLastUpdateMs(Date.now());
  }));

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
    formingQueue.clear();
    latestCandleByTfRef.current = emptyCandles();
    candleMergeRef.current = createCandleMergeStates(symbol);
    for (const task of Object.values(gapRepairsRef.current)) {
      task?.request?.abort();
      task?.retry?.dispose();
    }
    gapRepairsRef.current = emptyGapRepairs();
    setCandlesByTf(emptyCandles());
    setCandleGaps(emptyCandleGaps());
    setErrorsByTf(emptyErrors());
    setBookTicker(null);
    setLastUpdateMs(0);
    const nextHealth = createFeedHealthSnapshot(symbol);
    feedHealthRef.current = nextHealth;
    setFeedHealth(nextHealth);
    setStatus('loading');
    setIntegrity('loading');
    setMarketDataIntegrity('loading');
  }, [symbol, formingQueue, applyFeedHealth]);

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

    const updates: Partial<CandlesByTf> = {};
    const nextErrors = emptyErrors();
    const gaps: Partial<CandleGapsByTf> = {};
    let anyLive = false;

    for (let i = 0; i < TIMEFRAMES.length; i++) {
      const tf = TIMEFRAMES[i];
      const q = klinesQueries[i];
      if (q.isPending) continue;
      if (q.isSuccess && q.data) {
        const result = mergeRestCandles(candleMergeRef.current[tf], q.data, {
          receivedAtMs: q.dataUpdatedAt || Date.now(),
        });
        candleMergeRef.current[tf] = result.state;
        if (result.accepted) updates[tf] = result.state.candles as Candle[];
        if (result.gap) gaps[tf] = result.gap;
        anyLive = true;
        continue;
      }
      if (q.isError) {
        nextErrors[tf] = q.error instanceof Error ? q.error.message : 'fetch failed';
      }
    }

    if (!isCurrentContext()) return;
    setErrorsByTf(nextErrors);
    setStatus(anyLive ? 'live' : 'loading');
    if (Object.keys(gaps).length > 0) setCandleGaps((previous) => ({ ...previous, ...gaps }));
    if (Object.keys(updates).length > 0) {
      setCandlesByTf((previous) => ({ ...previous, ...updates }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySignature, symbol]);

  // Keep the callback's synchronous view aligned with REST/lazy history updates.
  useEffect(() => {
    latestCandleByTfRef.current = candlesByTf;
  }, [candlesByTf]);

  // ---- WebSocket: kline streams for all 6 TFs ----
  useEffect(() => {
    const dispose = subscribeKlines(
      symbol,
      TIMEFRAMES,
      (bar, tf, meta: KlineEventMeta) => {
        wsBarCountRef.current += 1;
        const repair = gapRepairsRef.current[tf];
        if (repair && repair.epoch === meta.connectionEpoch) {
          if (repair.buffered.length < MAX_BUFFERED_GAP_EVENTS) repair.buffered.push({ bar, meta });
          else repair.overflowed = true;
          return;
        }
        const accepted = acceptWebSocketCandle(candleMergeRef.current[tf], {
          source: 'websocket',
          symbol: meta.symbol,
          timeframe: tf,
          candle: bar,
          eventTimeMs: meta.serverEventMs,
          closed: meta.closed,
          connectionEpoch: meta.connectionEpoch,
        });
        if (!accepted.accepted || !accepted.candle) return;
        const acceptedCandle = accepted.candle;
        candleMergeRef.current[tf] = accepted.state;

        const receivedAt = Date.now();
        applyFeedHealth((current) => markFeedMessage(current, {
          kind: 'kline', timeframe: tf, epoch: meta.connectionEpoch, nowMs: receivedAt,
          serverEventMs: meta.serverEventMs,
          confirmedClosedCandleTime: meta.closed ? acceptedCandle.time : undefined,
        }));
        if (accepted.gap) {
          const currentRepair = gapRepairsRef.current[tf];
          if (!currentRepair || !sameCandleGap(currentRepair.gap, accepted.gap) || currentRepair.epoch !== meta.connectionEpoch) {
            currentRepair?.request?.abort();
            currentRepair?.retry?.dispose();
            gapRepairsRef.current[tf] = {
              gap: accepted.gap, epoch: meta.connectionEpoch, request: null, status: 'queued', buffered: [], overflowed: false,
              retry: null, contextGeneration: requestContextRef.current.generation,
            };
            setGapRepairTick((value) => value + 1);
          }
          setCandleGaps((previous) => ({ ...previous, [tf]: accepted.gap }));
          applyFeedHealth((current) => markFeedSynchronizing(current, {
            kind: 'kline', timeframe: tf, epoch: meta.connectionEpoch, nowMs: receivedAt,
          }));
        }
        // Execution remains immediate for accepted contiguous events. The gap
        // source event is visual-only until its missing movement is repaired.
        if (!accepted.gap) reconcileLiveTick(symbol, acceptedCandle.close, acceptedCandle.time);
        const latest = latestCandleByTfRef.current[tf];
        // Preserve the initial REST-load behaviour: do not render a lone
        // websocket candle before validated historical context is available.
        if (!latest || latest.length === 0) return;
        latestCandleByTfRef.current[tf] = accepted.state.candles as Candle[];
        if (accepted.action === 'update' && !meta.closed) {
          formingQueue.enqueue(tf, acceptedCandle);
          return;
        }

        // New bars and finalizations stay immediate so candle-close execution,
        // indicators, and alerts keep their existing semantics.
        formingQueue.flush();
        setCandlesByTf((previous) => {
          if (previous[tf].length === 0) return previous;
          return { ...previous, [tf]: accepted.state.candles as Candle[] };
        });
        setLastUpdateMs(Date.now());
      },
      (transport, epoch = 0) => {
        setWsStatus(transport);
        let restartRepair = false;
        for (const tf of TIMEFRAMES) {
          candleMergeRef.current[tf] = setCandleMergeEpoch(candleMergeRef.current[tf], epoch);
          const repair = gapRepairsRef.current[tf];
          if (repair && epoch > 0 && repair.epoch !== epoch) {
            repair.request?.abort();
            repair.retry?.dispose();
            gapRepairsRef.current[tf] = null;
            restartRepair = true;
          }
        }
        if (restartRepair) setGapRepairTick((value) => value + 1);
        const receivedAt = Date.now();
        applyFeedHealth((current) => {
          let next = current;
          for (const tf of TIMEFRAMES) {
            next = markFeedTransport(next, { kind: 'kline', timeframe: tf, transport, epoch, nowMs: receivedAt });
          }
          return next;
        });
      },
      () => {
        const summary = summarizeFeedHealth(feedHealthRef.current, Date.now());
        return summary.allRequiredKlinesLive && summary.tickerLive;
      },
    );
    return () => {
      formingQueue.clear();
      dispose();
    };
  }, [symbol, formingQueue, applyFeedHealth]);

  // Failed repair stays non-live, then re-enters this exact validated path
  // through one bounded retry chain. The request gate + context generation
  // reject an ABA symbol/timeframe response before it can requeue work.
  const scheduleGapRepairRetry = useCallback((tf: Timeframe, task: GapRepairTask) => {
    task.status = 'failed';
    if (offlineRef.current) return;
    const retry = task.retry ?? new BackoffRetry();
    task.retry = retry;
    const symbolAtSchedule = symbol;
    const generationAtSchedule = task.contextGeneration;
    retry.schedule(() => {
      if (offlineRef.current || gapRepairsRef.current[tf] !== task) return;
      if (requestContextRef.current.symbol !== symbolAtSchedule
        || requestContextRef.current.generation !== generationAtSchedule) return;
      task.status = 'queued';
      task.request = null;
      setGapRepairTick((value) => value + 1);
    }, () => !offlineRef.current
      && gapRepairsRef.current[tf] === task
      && requestContextRef.current.symbol === symbolAtSchedule
      && requestContextRef.current.generation === generationAtSchedule);
  }, [symbol]);

  // ---- Gap repair: bounded REST validation before a timeframe can be live ----
  useEffect(() => {
    for (const tf of TIMEFRAMES) {
      const gap = candleGaps[tf];
      if (!gap) continue;
      const existing = gapRepairsRef.current[tf];
      if (existing && sameCandleGap(existing.gap, gap) && existing.status !== 'queued') continue;

      const feed = feedHealthRef.current.feeds[`kline:${tf}`];
      if (!feed || feed.connectionEpoch <= 0) continue;
      const plan = planGapRepair(tf, gap);
      if (!plan.valid) {
        gapRepairsRef.current[tf] = {
          gap, epoch: feed.connectionEpoch, request: null, status: 'failed',
          buffered: existing?.buffered ?? [], overflowed: existing?.overflowed ?? false,
          retry: existing?.retry ?? null,
          contextGeneration: requestContextRef.current.generation,
        };
        applyFeedHealth((current) => markFeedSynchronizing(current, {
          kind: 'kline', timeframe: tf, epoch: feed.connectionEpoch, nowMs: Date.now(),
        }));
        continue;
      }
      const request = historicalGateRef.current.begin(symbol, tf, 'repair');
      const task: GapRepairTask = {
        gap, epoch: feed.connectionEpoch, request, status: 'repairing',
        buffered: existing?.buffered ?? [], overflowed: existing?.overflowed ?? false,
        retry: existing?.retry ?? null,
        contextGeneration: request.identity.generation,
      };
      gapRepairsRef.current[tf] = task;
      applyFeedHealth((current) => markFeedSynchronizing(current, {
        kind: 'kline', timeframe: tf, epoch: task.epoch, nowMs: Date.now(),
      }));

      void (async () => {
        try {
          const returned = await fetchKlinesRange(
            tf,
            symbol,
            plan.startTimeMs,
            plan.endTimeMs,
            plan.limit,
            request.signal,
          );
          if (!request.isCurrent() || gapRepairsRef.current[tf] !== task) return;
          const repaired = applyValidatedGapRepair(candleMergeRef.current[tf], plan, returned, Date.now());
          if (!repaired.ok || task.overflowed) {
            scheduleGapRepairRetry(tf, task);
            return;
          }

          candleMergeRef.current[tf] = repaired.state;
          const buffered = [...task.buffered].sort((left, right) => left.meta.serverEventMs - right.meta.serverEventMs);
          for (const bufferedEvent of buffered) {
            const accepted = acceptWebSocketCandle(candleMergeRef.current[tf], {
              source: 'websocket',
              symbol: bufferedEvent.meta.symbol,
              timeframe: tf,
              candle: bufferedEvent.bar,
              eventTimeMs: bufferedEvent.meta.serverEventMs,
              closed: bufferedEvent.meta.closed,
              connectionEpoch: bufferedEvent.meta.connectionEpoch,
            });
            if (!accepted.accepted || !accepted.candle) continue;
            candleMergeRef.current[tf] = accepted.state;
            if (accepted.gap) continue;
            reconcileLiveTick(symbol, accepted.candle.close, accepted.candle.time);
          }
          if (!request.isCurrent() || gapRepairsRef.current[tf] !== task) return;
          // Buffered events can reveal another discontinuity. Repair one gap
          // at a time, using the canonical state's unresolved-gap queue.
          const followupGap = candleMergeRef.current[tf].gaps[0] ?? null;

          formingQueue.flush();
          const nextCandles = candleMergeRef.current[tf].candles as Candle[];
          latestCandleByTfRef.current[tf] = nextCandles;
          setCandlesByTf((previous) => previous[tf].length === 0
            ? previous
            : { ...previous, [tf]: nextCandles });
          setLastUpdateMs(Date.now());

          task.retry?.reset();
          gapRepairsRef.current[tf] = null;
          if (followupGap) {
            gapRepairsRef.current[tf] = {
              gap: followupGap,
              epoch: task.epoch,
              request: null,
              status: 'queued',
              buffered: [],
              overflowed: false,
              retry: null,
              contextGeneration: requestContextRef.current.generation,
            };
            setCandleGaps((previous) => ({ ...previous, [tf]: followupGap }));
            applyFeedHealth((current) => markFeedSynchronizing(current, {
              kind: 'kline', timeframe: tf, epoch: task.epoch, nowMs: Date.now(),
            }));
            setGapRepairTick((value) => value + 1);
            return;
          }

          setCandleGaps((previous) => sameCandleGap(previous[tf], gap)
            ? { ...previous, [tf]: null }
            : previous);
          applyFeedHealth((current) => markFeedRepaired(current, {
            kind: 'kline', timeframe: tf, epoch: task.epoch, nowMs: Date.now(),
          }));
        } catch (error) {
          if (!isAbortError(error) && request.isCurrent() && gapRepairsRef.current[tf] === task) {
            scheduleGapRepairRetry(tf, task);
          }
        } finally {
          request.finish();
        }
      })();
    }
  }, [candleGaps, symbol, gapRepairTick, applyFeedHealth, formingQueue, scheduleGapRepairRetry]);

  // ---- Browser sleep/wake, offline and silent-stream recovery ----
  useEffect(() => {
    const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const markOffline = () => {
      offlineRef.current = true;
      recoveryCoordinatorRef.current?.setOffline(true);
      suspendMarketDataTransports(symbol);
      for (const task of Object.values(gapRepairsRef.current)) task?.retry?.cancel();
      const nowMs = Date.now();
      applyFeedHealth((current) => {
        let next = current;
        for (const tf of TIMEFRAMES) {
          const feed = next.feeds[`kline:${tf}`];
          if (feed?.connectionEpoch) next = markFeedTransport(next, {
            kind: 'kline', timeframe: tf, transport: 'closed', epoch: feed.connectionEpoch, nowMs,
          });
        }
        for (const kind of ['ticker', 'bookTicker'] as const) {
          const feed = next.feeds[kind];
          if (feed?.connectionEpoch) next = markFeedTransport(next, {
            kind, transport: 'closed', epoch: feed.connectionEpoch, nowMs,
          });
        }
        return next;
      });
      setIntegrityRefresh((value) => value + 1);
    };

    const coordinator = new MarketDataRecoveryCoordinator({
      recover: () => {
        if (offlineRef.current || !isOnline()) return;
        const nowMs = Date.now();
        applyFeedHealth((current) => refreshFeedHealth(current, nowMs));
        const summary = summarizeFeedHealth(feedHealthRef.current, nowMs);
        if (summary.allRequiredKlinesLive && summary.tickerLive) return;
        // This only creates fresh transport epochs; it cannot promote trust.
        // Valid messages, continuity repair and ticker freshness remain the
        // existing authorities for returning MarketDataIntegrity to live.
        recoverMarketDataTransports(symbol);
        setGapRepairTick((value) => value + 1);
        setIntegrityRefresh((value) => value + 1);
      },
    });
    recoveryCoordinatorRef.current = coordinator;
    if (!isOnline()) markOffline();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') coordinator.request('visibilitychange');
    };
    const onPageShow = () => coordinator.request('pageshow');
    const onOffline = () => markOffline();
    const onOnline = () => {
      offlineRef.current = false;
      coordinator.setOffline(false);
      coordinator.request('online');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      coordinator.dispose();
      if (recoveryCoordinatorRef.current === coordinator) recoveryCoordinatorRef.current = null;
      for (const task of Object.values(gapRepairsRef.current)) task?.retry?.dispose();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [symbol, applyFeedHealth]);

  // Re-evaluate each feed at its own freshness boundary. Quote traffic never
  // refreshes candle freshness, and normal live messages only update a ref so
  // Stage 2's forming-tick batching remains intact.
  useEffect(() => {
    const nowMs = Date.now();
    const refreshed = refreshFeedHealth(feedHealthRef.current, nowMs);
    applyFeedHealth(() => refreshed);
    const messageTimes = Object.values(refreshed.feeds)
      .filter((feed) => feed.lastValidMessageMs > nowMs - 15_000)
      .map((feed) => feed.lastValidMessageMs);
    const dueAt = messageTimes.length > 0
      ? Math.min(...messageTimes.map((time) => time + 15_000))
      : nowMs + 15_000;
    const timeout = window.setTimeout(() => {
      applyFeedHealth((current) => refreshFeedHealth(current, Date.now()));
      setIntegrityRefresh((n) => n + 1);
      const summary = summarizeFeedHealth(feedHealthRef.current, Date.now());
      if (!summary.allRequiredKlinesLive || !summary.tickerLive) {
        recoveryCoordinatorRef.current?.request('stale');
      }
    }, Math.max(0, dueAt - Date.now()) + 1);
    return () => window.clearTimeout(timeout);
  }, [feedHealth, integrityRefresh, applyFeedHealth]);

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
      feedHealth: refreshFeedHealth(feedHealthRef.current, Date.now()),
    });
    setIntegrity(next);
    setMarketDataIntegrity(next);
    setStatus(next === 'live' ? 'live' : 'loading');
  }, [candlesByTf, errorsByTf, querySignature, wsStatus, lastUpdateMs, integrityRefresh, feedHealth]);

  // ---- WebSocket: bookTicker for real-time bid/ask ----
  useEffect(() => {
    const dispose = subscribeBookTicker(
      symbol,
      (ticker, meta) => {
        setBookTicker(ticker);
        applyFeedHealth((current) => markFeedMessage(current, {
          kind: 'bookTicker', epoch: meta.connectionEpoch, nowMs: Date.now(),
        }));
      },
      (transport, epoch) => applyFeedHealth((current) => markFeedTransport(current, {
        kind: 'bookTicker', transport, epoch: epoch ?? 0, nowMs: Date.now(),
      })),
    );
    if (offlineRef.current) suspendMarketDataTransports(symbol);
    return dispose;
  }, [symbol, applyFeedHealth]);

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
    const merged = mergeRestCandles(candleMergeRef.current[tf], older, { receivedAtMs: Date.now() });
    candleMergeRef.current[tf] = merged.state;
    if (merged.gap) setCandleGaps((previous) => ({ ...previous, [tf]: merged.gap }));
    if (merged.accepted) {
      setCandlesByTf((previous) => {
        if (!request.isCurrent() || previous[tf].length === 0) return previous;
        return { ...previous, [tf]: merged.state.candles as Candle[] };
      });
    }
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
      const merged = mergeRestCandles(candleMergeRef.current[tf], olderAll, { receivedAtMs: Date.now() });
      candleMergeRef.current[tf] = merged.state;
      if (merged.gap) setCandleGaps((previous) => ({ ...previous, [tf]: merged.gap }));
      if (!merged.accepted) {
        noMoreOlderRef.current[key] = true;
        return;
      }
      setCandlesByTf((previous) => {
        if (!request.isCurrent() || previous[tf].length === 0) return previous;
        return { ...previous, [tf]: merged.state.candles as Candle[] };
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

    // REST seeds the display only. Execution trust remains non-live until this
    // supervisor receives a valid current-epoch ticker event.
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

    const dispose = subscribeTicker(
      symbol,
      (ticker, meta) => {
        setTicker24h(ticker);
        applyFeedHealth((current) => markFeedMessage(current, {
          kind: 'ticker', epoch: meta.connectionEpoch, nowMs: Date.now(), serverEventMs: meta.serverEventMs,
        }));
      },
      (transport, epoch) => applyFeedHealth((current) => markFeedTransport(current, {
        kind: 'ticker', transport, epoch: epoch ?? 0, nowMs: Date.now(),
      })),
    );
    if (offlineRef.current) suspendMarketDataTransports(symbol);

    return () => {
      active = false;
      dispose();
    };
  }, [symbol, applyFeedHealth]);

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
    feedHealth,
    candleGaps,
    loadOlder,
    loadHistoryUntil,
  };
}
