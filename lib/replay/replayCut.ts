// Replay cut store — the bridge between ChartPanel (which owns the replay UI
// and playIndex) and app-level consumers (mood engine, scanner, SMC screener,
// market context) that must never see candles beyond the replay moment
// (the Prime Invariant). Same useSyncExternalStore pattern as chartHoverStore.
//
// Stage 1 (index-based correctness): ChartPanel publishes the current replay
// bar; consumers slice their inputs with lib/replay/replaySlice.ts.

import { useSyncExternalStore } from 'react';
import type { Candle, Timeframe } from '../types';

export interface ReplayCut {
  active: boolean;
  /** The replay eval timeframe (the chart's TF when replay started). */
  evalTf: Timeframe;
  /** The current replay bar (its close bounds "now"). */
  cutBar: Candle | null;
}

const INACTIVE: ReplayCut = { active: false, evalTf: '15m', cutBar: null };

const listeners = new Set<() => void>();
let state: ReplayCut = INACTIVE;

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): ReplayCut {
  return state;
}

export function setReplayCut(evalTf: Timeframe, cutBar: Candle): void {
  if (state.active && state.evalTf === evalTf && state.cutBar?.time === cutBar.time) return;
  state = { active: true, evalTf, cutBar };
  emit();
}

export function clearReplayCut(): void {
  if (!state.active) return;
  state = INACTIVE;
  emit();
}

export function useReplayCut(): ReplayCut {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
