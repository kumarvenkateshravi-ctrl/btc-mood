'use client';

// Saved workspaces: named snapshots of what you're looking at (chart type,
// symbol, timeframe, indicator stack), persisted to localStorage and
// switchable. Free + instant — TradingView gates this behind login.

import { useSyncExternalStore } from 'react';

export interface Workspace {
  id: string;
  name: string;
  chartType: string;
  symbol: string;
  tf: string;
  indicatorIds: string[];
}

/** The subset of dashboard state a workspace captures. */
export type WorkspaceConfig = Omit<Workspace, 'id' | 'name'>;

export const WORKSPACES_KEY = 'btc-mood:workspaces:v1';

export function newWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function isWorkspace(v: unknown): v is Workspace {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.id === 'string' &&
    typeof w.name === 'string' &&
    typeof w.chartType === 'string' &&
    typeof w.symbol === 'string' &&
    typeof w.tf === 'string' &&
    Array.isArray(w.indicatorIds) &&
    w.indicatorIds.every((x) => typeof x === 'string')
  );
}

/** Pure: append a workspace (replacing any with the same name, case-insensitive). */
export function upsertWorkspace(list: Workspace[], name: string, config: WorkspaceConfig): Workspace[] {
  const trimmed = name.trim() || 'Untitled';
  const without = list.filter((w) => w.name.toLowerCase() !== trimmed.toLowerCase());
  return [{ id: newWorkspaceId(), name: trimmed, ...config }, ...without];
}

export function removeWorkspace(list: Workspace[], id: string): Workspace[] {
  return list.filter((w) => w.id !== id);
}

// ----- Reactive store -----------------------------------------------------

let cache: Workspace[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: Workspace[] = [];

function load(): Workspace[] {
  if (cache) return cache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(WORKSPACES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isWorkspace) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: Workspace[]) {
  cache = next;
  try {
    window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function saveWorkspace(name: string, config: WorkspaceConfig) {
  save(upsertWorkspace(load(), name, config));
}

export function deleteWorkspace(id: string) {
  save(removeWorkspace(load(), id));
}

export function useWorkspaces(): Workspace[] {
  return useSyncExternalStore(subscribe, () => cache ?? load(), () => EMPTY);
}
