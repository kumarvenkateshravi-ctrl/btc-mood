import { useSyncExternalStore } from 'react';
import type { MarketDataIntegrity } from '../marketDataIntegrity';
import type { Candle, Timeframe } from '../types';

export interface ReplayDataset {
  active: boolean;
  symbol: string;
  sessionId: string;
  /** Fixed at capture time; playback and execution never rebase away from it. */
  executionTf: Timeframe;
  candlesByTf: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
}

const INACTIVE: ReplayDataset = Object.freeze({
  active: false,
  symbol: '',
  sessionId: '',
  executionTf: '15m' as Timeframe,
  candlesByTf: Object.freeze({}),
});

interface ReplayDatasetContainer {
  value: ReplayDataset;
  listeners: Set<() => void>;
}
const replayDatasetRoot = globalThis as typeof globalThis & { __mcsReplayDatasetV1?: ReplayDatasetContainer };
const replayDatasetContainer = replayDatasetRoot.__mcsReplayDatasetV1 ??= {
  value: INACTIVE,
  listeners: new Set<() => void>(),
};

export function __subscribeReplayDatasetForTest(listener: () => void): () => void {
  replayDatasetContainer.listeners.add(listener);
  return () => replayDatasetContainer.listeners.delete(listener);
}

export function __getReplayDatasetListenerCountForTest(): number {
  return replayDatasetContainer.listeners.size;
}

function emit() {
  for (const listener of replayDatasetContainer.listeners) listener();
}

function freezeCandles(candles: Candle[]): readonly Candle[] {
  return Object.freeze(candles.map((candle) => Object.freeze({ ...candle })));
}

function freezeDataset(input: {
  symbol: string;
  executionTf: Timeframe;
  sessionId?: string;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}): ReplayDataset {
  const cloned: Partial<Record<Timeframe, readonly Candle[]>> = {};
  for (const [tf, candles] of Object.entries(input.candlesByTf) as [Timeframe, Candle[]][]) {
    cloned[tf] = freezeCandles(candles ?? []);
  }
  const execution = input.candlesByTf[input.executionTf] ?? [];
  const sessionId = input.sessionId ?? ['replay', input.symbol, input.executionTf, execution.length, execution[0]?.time ?? 0, execution.at(-1)?.time ?? 0].join(':');
  return Object.freeze({
    active: true,
    symbol: input.symbol,
    sessionId,
    executionTf: input.executionTf,
    candlesByTf: Object.freeze(cloned),
  });
}

/** Capture the exact candles available to the chart at replay start. */
export function captureReplayDataset(input: {
  symbol: string;
  executionTf: Timeframe;
  sessionId?: string;
  candlesByTf: Partial<Record<Timeframe, Candle[]>>;
}): ReplayDataset {
  replayDatasetContainer.value = freezeDataset(input);
  emit();
  return replayDatasetContainer.value;
}

export function clearReplayDataset(): void {
  if (!replayDatasetContainer.value.active) return;
  replayDatasetContainer.value = INACTIVE;
  emit();
}

/** Release a captured book before a new chart symbol becomes active. */
export function clearReplayDatasetForSymbol(nextSymbol: string): void {
  if (replayDatasetContainer.value.active && replayDatasetContainer.value.symbol !== nextSymbol) clearReplayDataset();
}

export function getReplayDataset(): ReplayDataset {
  return replayDatasetContainer.value;
}

export function useReplayDataset(): ReplayDataset {
  return useSyncExternalStore(
    (listener) => {
      replayDatasetContainer.listeners.add(listener);
      return () => replayDatasetContainer.listeners.delete(listener);
    },
    getReplayDataset,
    getReplayDataset,
  );
}

/** Replay needs valid historical data, but never fabricated demo/unavailable data. */
export function canStartReplayFromIntegrity(integrity: MarketDataIntegrity): boolean {
  return integrity === 'live' || integrity === 'historical' || integrity === 'stale' || integrity === 'partial';
}
