'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../types';
import { fetchKlinesBefore } from '../fetcher';
import { TF_MS } from '../dashboardUrl';
import type { CompareSymbol } from '../compare';
import { HistoricalRequestGate, type HistoricalRequest } from '../historicalRequestIdentity';

export interface HistoryWindow {
  historyCandles: Candle[] | null;
  fitSignal: number;
  jumpToDate: (dateMs: number) => Promise<void>;
  returnToLive: () => void;
  loadOlderHistory: () => Promise<void>;
}

/**
 * Jump-to-date: a focused historical window for the selected TF.
 * When `historyCandles` is set, the chart shows this static window
 * instead of the live stream. Also supports extending the window
 * further back (scroll-left in jump view).
 */
export function useHistoryWindow(
  selected: Timeframe,
  symbol: CompareSymbol,
): HistoryWindow {
  const [historyCandles, setHistoryCandles] = useState<Candle[] | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const requestGateRef = useRef(new HistoricalRequestGate());
  const historyLoadingRef = useRef<HistoricalRequest | null>(null);
  const requestContextRef = useRef({ selected, symbol });
  if (
    requestContextRef.current.selected !== selected ||
    requestContextRef.current.symbol !== symbol
  ) {
    requestContextRef.current = { selected, symbol };
    requestGateRef.current.invalidate();
    historyLoadingRef.current = null;
  }

  // Clear the window when TF or symbol changes.
  useEffect(() => {
    setHistoryCandles(null);

  }, [selected, symbol]);

  useEffect(() => () => requestGateRef.current.invalidate(), []);

  const jumpToDate = useCallback(
    async (dateMs: number) => {
      const tf = selected;
      const endTime = dateMs + TF_MS[tf] * 30;
      const request = requestGateRef.current.begin(symbol, tf, 'history-window');
      historyLoadingRef.current = request;
      try {
        const window = await fetchKlinesBefore(tf, symbol, endTime, 1000, request.signal);
        if (window.length > 0) {
          setHistoryCandles((prev) => (request.isCurrent() ? window : prev));
          setFitSignal((n) => (request.isCurrent() ? n + 1 : n));
        }
      } catch {
        // ignore — leave the current view
      } finally {
        if (historyLoadingRef.current?.identity.requestId === request.identity.requestId) {
          historyLoadingRef.current = null;
        }
        request.finish();
      }
    },
    [selected, symbol],
  );

  const returnToLive = useCallback(() => {
    requestGateRef.current.invalidate();
    historyLoadingRef.current = null;
    setHistoryCandles(null);
    setFitSignal((n) => n + 1);
  }, []);

  const loadOlderHistory = useCallback(async () => {
    if (historyLoadingRef.current?.isCurrent() || !historyCandles || historyCandles.length === 0) return;
    const request = requestGateRef.current.begin(symbol, selected, 'history-window');
    historyLoadingRef.current = request;
    try {
      const older = await fetchKlinesBefore(
        selected,
        symbol,
        historyCandles[0].time * 1000,
        1000,
        request.signal,
      );
      if (request.isCurrent() && older.length > 0) {
        setHistoryCandles((prev) => {
          if (!request.isCurrent()) return prev;
          if (!prev || prev.length === 0) return prev;
          const merged = older.filter((c) => c.time < prev[0].time);
          return merged.length ? [...merged, ...prev] : prev;
        });
      }
    } catch {
      // ignore
    } finally {
      if (historyLoadingRef.current?.identity.requestId === request.identity.requestId) {
        historyLoadingRef.current = null;
      }
      request.finish();
    }
  }, [historyCandles, selected, symbol]);

  return { historyCandles, fitSignal, jumpToDate, returnToLive, loadOlderHistory };
}
