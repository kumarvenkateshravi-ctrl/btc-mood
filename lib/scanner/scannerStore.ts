// Technical Scanner — persistence (Rule 4: immutable history). Strategies
// version (never overwrite); signals and events APPEND (dedup by immutable
// id, never edit/delete); "delete" is an archive flag. localStorage-backed,
// SSR-safe, same conventions as paperStore.

import { validateStrategy, type ValidationResult } from './validate';
import type { GroupNode, ScannerStrategy } from './types';
import type { ScannerSignal } from './signals';
import type { ScannerEvent } from './events';

const K_STRATEGIES = 'mcs.scanner.strategies.v1';
const K_SIGNALS = 'mcs.scanner.signals.v1';
const K_EVENTS = 'mcs.scanner.events.v1';
const SIGNAL_CAP = 500;
const EVENT_CAP = 2000;

const read = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
};
const write = (key: string, value: unknown): void => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — non-fatal */ }
};

// ---- Strategies -------------------------------------------------------------

export function listStrategies(): ScannerStrategy[] {
  return read<ScannerStrategy[]>(K_STRATEGIES, []);
}

export function getStrategy(id: string): ScannerStrategy | undefined {
  return listStrategies().find((s) => s.id === id);
}

/** Create with version 1. REFUSES invalid strategies (validation before persistence). */
export function createStrategy(
  input: { name: string; direction: 'long' | 'short'; tree: GroupNode; note?: string;
           exits?: ScannerStrategy['exits'] },
  now: number = Date.now(),
): { strategy: ScannerStrategy | null; validation: ValidationResult } {
  const strategy: ScannerStrategy = {
    id: `strat_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    direction: input.direction,
    schemaVersion: 1,
    versions: [{ v: 1, createdAt: now, note: input.note ?? 'Initial version', tree: input.tree }],
    activeVersion: 1,
    enabled: false,
    archived: false,
    exits: input.exits ?? { slAtr: 1.5, tp1R: 1, tp2R: 2, tp3R: 3 },
    ownerId: null, visibility: 'private',
    createdAt: now, updatedAt: now,
    parentStrategy: null, forkCount: 0, likes: 0,
  };
  const validation = validateStrategy(strategy);
  if (!validation.ok) return { strategy: null, validation };
  write(K_STRATEGIES, [...listStrategies(), strategy]);
  return { strategy, validation };
}

/** Editing ALWAYS creates a new immutable version; prior versions are frozen
 *  (their performance snapshot is attached by the analytics sprint). */
export function saveNewVersion(
  id: string,
  tree: GroupNode,
  note: string,
  now: number = Date.now(),
): { strategy: ScannerStrategy | null; validation: ValidationResult } {
  const all = listStrategies();
  const s = all.find((x) => x.id === id);
  if (!s) {
    return {
      strategy: null,
      validation: { ok: false, errors: [{ path: 'root', code: 'not-found', message: `strategy ${id} not found` }], warnings: [], complexity: { depth: 0, conditions: 0, groups: 0, timeframes: [], sources: [], uniqueSeries: 0, costUnits: 0, cost: 'low' } },
    };
  }
  const v = Math.max(...s.versions.map((x) => x.v)) + 1;
  const candidate: ScannerStrategy = {
    ...s,
    versions: [...s.versions, { v, createdAt: now, note, tree }],
    activeVersion: v,
    updatedAt: now,
  };
  const validation = validateStrategy(candidate);
  if (!validation.ok) return { strategy: null, validation };
  write(K_STRATEGIES, all.map((x) => (x.id === id ? candidate : x)));
  return { strategy: candidate, validation };
}

export function setStrategyEnabled(id: string, enabled: boolean): void {
  write(K_STRATEGIES, listStrategies().map((s) => (s.id === id ? { ...s, enabled, updatedAt: Date.now() } : s)));
}

export function setActiveVersion(id: string, v: number): void {
  write(K_STRATEGIES, listStrategies().map((s) =>
    s.id === id && s.versions.some((x) => x.v === v) ? { ...s, activeVersion: v, updatedAt: Date.now() } : s));
}

/** Rule 4: never delete — archive. */
export function archiveStrategy(id: string): void {
  write(K_STRATEGIES, listStrategies().map((s) => (s.id === id ? { ...s, archived: true, enabled: false, updatedAt: Date.now() } : s)));
}

// ---- Signals + events (append-only) -----------------------------------------

export function listSignals(): ScannerSignal[] {
  return read<ScannerSignal[]>(K_SIGNALS, []);
}

/** Append new signals; existing ids are NEVER touched (immutability). */
export function recordSignals(signals: ScannerSignal[]): number {
  const existing = listSignals();
  const known = new Set(existing.map((s) => s.id));
  const fresh = signals.filter((s) => !known.has(s.id));
  if (fresh.length === 0) return 0;
  write(K_SIGNALS, [...existing, ...fresh].slice(-SIGNAL_CAP));
  return fresh.length;
}

export function listEvents(): ScannerEvent[] {
  return read<ScannerEvent[]>(K_EVENTS, []);
}

/** Append new events by eventId; recorded events are immutable. */
export function recordEvents(events: ScannerEvent[]): number {
  const existing = listEvents();
  const known = new Set(existing.map((e) => e.eventId));
  const fresh = events.filter((e) => !known.has(e.eventId));
  if (fresh.length === 0) return 0;
  write(K_EVENTS, [...existing, ...fresh].slice(-EVENT_CAP));
  return fresh.length;
}

/** Test-only. */
export function __resetScannerStoreForTest(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(K_STRATEGIES);
  window.localStorage.removeItem(K_SIGNALS);
  window.localStorage.removeItem(K_EVENTS);
}
