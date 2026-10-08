// Replay state machine (Phase 2.A) — the deterministic, single source of
// truth for the replay lifecycle:
//
//   idle → selecting → ready → playing ⇄ paused → finished → idle
//
// Illegal transitions are ignored (warned in dev) instead of corrupting
// state. ChartPanel drives the actions; any module (alerts, live side
// effects) can read the phase instead of scattered booleans.

import { useSyncExternalStore } from 'react';
import { clearReplayDataset } from './replayDataset';

export type ReplayPhase = 'idle' | 'selecting' | 'ready' | 'playing' | 'paused' | 'finished';

export interface ReplayStateSnapshot {
  phase: ReplayPhase;
  /** Current replay bar index on the eval timeframe (0-based). */
  playIndex: number;
  /** The cut point picked by the user — `Home` restarts here. */
  startIndex: number;
  /**
   * Wall-clock "now" of the replay moment (close of the current bar).
   * TIME is the real key (Phase 3): switching timeframes re-derives the
   * indices from these instead of exiting replay.
   */
  cutTime: number | null;
  /** Wall-clock moment of the original cut (Home target across TFs). */
  startTime: number | null;
}

const TRANSITIONS: Record<ReplayPhase, ReplayPhase[]> = {
  idle: ['selecting'],
  selecting: ['idle', 'ready'],
  ready: ['playing', 'paused', 'idle'],
  playing: ['paused', 'finished', 'idle'],
  paused: ['playing', 'finished', 'idle'],
  finished: ['playing', 'paused', 'idle'],
};

const IDLE: ReplayStateSnapshot = { phase: 'idle', playIndex: 0, startIndex: 0, cutTime: null, startTime: null };

interface ReplayStateContainer {
  value: ReplayStateSnapshot;
  listeners: Set<() => void>;
}
const replayStateRoot = globalThis as typeof globalThis & { __mcsReplayStateV1?: ReplayStateContainer };
const replayStateContainer = replayStateRoot.__mcsReplayStateV1 ??= {
  value: IDLE,
  listeners: new Set<() => void>(),
};

function emit() {
  for (const fn of replayStateContainer.listeners) fn();
}

function subscribe(fn: () => void): () => void {
  replayStateContainer.listeners.add(fn);
  return () => {
    replayStateContainer.listeners.delete(fn);
  };
}

function getSnapshot(): ReplayStateSnapshot {
  return replayStateContainer.value;
}

function transition(to: ReplayPhase, patch?: Partial<ReplayStateSnapshot>): boolean {
  if (replayStateContainer.value.phase === to && !patch) return false;
  if (replayStateContainer.value.phase !== to && !TRANSITIONS[replayStateContainer.value.phase].includes(to)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[replay] illegal transition ${replayStateContainer.value.phase} → ${to} ignored`);
    }
    return false;
  }
  replayStateContainer.value = { ...replayStateContainer.value, ...patch, phase: to };
  emit();
  return true;
}

export const replayActions = {
  enterSelecting(): boolean {
    return transition('selecting');
  },
  /** Cut picked: replay is armed at `index`; `now` = close time of that bar. */
  startAt(index: number, now: number | null = null): boolean {
    return transition('ready', { playIndex: index, startIndex: index, cutTime: now, startTime: now });
  },
  /** Keep the wall-clock moment in sync as the head moves (no transition). */
  syncCutTime(now: number): void {
    if (replayStateContainer.value.phase === 'idle' || replayStateContainer.value.phase === 'selecting') return;
    if (replayStateContainer.value.cutTime === now) return;
    replayStateContainer.value = { ...replayStateContainer.value, cutTime: now };
    emit();
  },
  /**
   * Re-derive the indices for a NEW timeframe from the preserved wall-clock
   * moment — the multi-TF switch. Phase is preserved (playing keeps playing).
   */
  rebase(playIndex: number, startIndex: number): void {
    if (replayStateContainer.value.phase === 'idle' || replayStateContainer.value.phase === 'selecting') return;
    if (replayStateContainer.value.playIndex === playIndex && replayStateContainer.value.startIndex === startIndex) return;
    replayStateContainer.value = { ...replayStateContainer.value, playIndex, startIndex };
    emit();
  },
  play(): boolean {
    return transition('playing');
  },
  pause(): boolean {
    return transition('paused');
  },
  finish(): boolean {
    return transition('finished');
  },
  exit(): boolean {
    clearReplayDataset();
    if (replayStateContainer.value.phase === 'idle') return false;
    replayStateContainer.value = IDLE;
    emit();
    return true;
  },
  /**
   * Move the replay head (scrub, step, auto-advance). Clamped to
   * [1, total-1]. Reaching the last bar while playing finishes; scrubbing
   * back off the end returns finished → paused.
   */
  scrubTo(index: number, total: number): void {
    if (replayStateContainer.value.phase === 'idle' || replayStateContainer.value.phase === 'selecting') return;
    const clamped = Math.max(1, Math.min(total - 1, index));
    const atEnd = clamped >= total - 1;
    let phase = replayStateContainer.value.phase;
    if (atEnd && phase === 'playing') phase = 'finished';
    if (!atEnd && phase === 'finished') phase = 'paused';
    // Rewinding needs an atomic session reconstruction, never another tick.
    if (clamped < replayStateContainer.value.playIndex && phase === 'playing') phase = 'paused';
    if (clamped === replayStateContainer.value.playIndex && phase === replayStateContainer.value.phase) return;
    replayStateContainer.value = { ...replayStateContainer.value, playIndex: clamped, phase };
    emit();
  },
  stepBy(n: number, total: number): void {
    replayActions.scrubTo(replayStateContainer.value.playIndex + n, total);
  },
};

export function useReplayState(): ReplayStateSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-hook accessor for imperative code paths. */
export function getReplayState(): ReplayStateSnapshot {
  return replayStateContainer.value;
}

export function isReplayActive(phase: ReplayPhase): boolean {
  return phase === 'ready' || phase === 'playing' || phase === 'paused' || phase === 'finished';
}
