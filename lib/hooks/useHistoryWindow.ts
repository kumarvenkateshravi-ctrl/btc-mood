'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../types';
import { fetchKlinesBefore } from '../fetcher';
import { TF_MS } from '../dashboardUrl';
import type { CompareSymbol } from '../compare';

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
  const historyLoadingRef = useRef(false);

  // Clear the window when TF or symbol changes.
  useEffect(() => {
    setHistoryCandles(null);
  }, [selected, symbol]);

  const jumpToDate = useCallback(
    async (dateMs: number) => {
      const tf = selected;
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

  const loadOlderHistory = useCallback(async () => {
    if (historyLoadingRef.current || !historyCandles || historyCandles.length === 0) return;
    historyLoadingRef.current = true;
    try {
      const older = await fetchKlinesBefore(
        selected,
        symbol,
        historyCandles[0].time * 1000,
        1000,
      );
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

  return { historyCandles, fitSignal, jumpToDate, returnToLive, loadOlderHistory };
}
