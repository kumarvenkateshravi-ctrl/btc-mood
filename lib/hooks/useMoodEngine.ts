'use client';

import { useMemo } from 'react';
import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { aggregateMood, computeSignal, type MoodVerdict, type TFSnapshot } from '../signals';
import { CUSTOM_INDICATORS } from '../customIndicatorsLibrary';

export interface MoodEngineResult {
  prices: Record<Timeframe, number | null>;
  changes: Record<Timeframe, number | null>;
  snapshots: Record<Timeframe, TFSnapshot | null>;
  mood: MoodVerdict;
  indicatorRows: Array<{
    key: string;
    label: string;
    sub: string;
    cells: Record<string, 'buy' | 'sell' | 'neutral'>;
  }>;
}

/**
 * Derives the per-TF signal snapshots, prices, changes, the aggregate
 * mood verdict, and the per-indicator signal matrix rows from the
 * candle state. Pure memoization over candlesByTf + activeIndicatorIds.
 */
export function useMoodEngine(
  candlesByTf: Record<Timeframe, Candle[]>,
  activeIndicatorIds: string[],
): MoodEngineResult {
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
    () =>
      aggregateMood(
        TIMEFRAMES.map((tf) => snapshots[tf]).filter(Boolean) as TFSnapshot[],
      ),
    [snapshots],
  );

  const indicatorRows = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      sub: string;
      cells: Record<string, 'buy' | 'sell' | 'neutral'>;
    }> = [];
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

  return { prices, changes, snapshots, mood, indicatorRows };
}
