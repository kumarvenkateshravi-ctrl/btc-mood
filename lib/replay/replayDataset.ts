import { useSyncExternalStore } from 'react';
import type { MarketDataIntegrity } from '../marketDataIntegrity';
import type { Candle, Timeframe } from '../types';

export interface ReplayDataset {
  active: boolean;
  symbol: string;
  /** Fixed at capture time; playback and execution never rebase away from it. */
  executionTf: Timeframe;
  candlesByTf: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
}

const INACTIVE: ReplayDataset = Object.freeze({
  active: false,
  symbol: '',
  executionTf: '15m' as Timeframe,
  candlesByTf: Object.freeze({}),
});

let state: ReplayDataset = INACTIVE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function freezeCandles(candles: Candle[]): readonly Candle[] {
  return Object.freeze(candles.map((candle) => Object.freeze({ ...candle })));
}

function freezeDataset(input: {
  symbol: string;
  executionTf: Timeframe;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}): ReplayDataset {
  const cloned: Partial<Record<Timeframe, readonly Candle[]>> = {};
  for (const [tf, candles] of Object.entries(input.candlesByTf) as [Timeframe, Candle[]][]) {
    cloned[tf] = freezeCandles(candles ?? []);
  }
  return Object.freeze({
    active: true,
    symbol: input.symbol,
    executionTf: input.executionTf,
    candlesByTf: Object.freeze(cloned),
  });
}

/** Capture the exact candles available to the chart at replay start. */
export function captureReplayDataset(input: {
  symbol: string;
  executionTf: Timeframe;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}): ReplayDataset {
  state = freezeDataset(input);
  emit();
  return state;
}

export function clearReplayDataset(): void {
  if (!state.active) return;
  state = INACTIVE;
  emit();
}

/** Release a captured book before a new chart symbol becomes active. */
export function clearReplayDatasetForSymbol(nextSymbol: string): void {
  if (state.active && state.symbol !== nextSymbol) clearReplayDataset();
}

export function getReplayDataset(): ReplayDataset {
  return state;
}

export function useReplayDataset(): ReplayDataset {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getReplayDataset,
    getReplayDataset,
  );
}

/** Replay needs valid historical data, but never fabricated demo/unavailable data. */
export function canStartReplayFromIntegrity(integrity: MarketDataIntegrity): boolean {
  return integrity === 'live' || integrity === 'historical' || integrity === 'stale' || integrity === 'partial';
}
