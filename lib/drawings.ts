'use client';

// Chart drawings: model, geometry helpers, and a per-symbol reactive store.
// Drawings are stored in the chart's own time/price space (the values the
// lightweight-charts time scale returns), so they stick to the bars on
// pan/zoom and round-trip through localStorage. Persisted per symbol — a
// trendline drawn on BTC stays on BTC across timeframe switches.

import { useSyncExternalStore } from 'react';

export type DrawingType =
  | 'horizontal'
  | 'trendline'
  | 'ray'
  | 'rectangle'
  | 'fib'
  | 'measure'
  | 'text';

export type Tool = 'cursor' | DrawingType;

export interface DPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DPoint[];
  color: string;
  text?: string;
}

/** How many points each tool needs before it commits. */
export const TOOL_POINTS: Record<DrawingType, 1 | 2> = {
  horizontal: 1,
  text: 1,
  trendline: 2,
  ray: 2,
  rectangle: 2,
  fib: 2,
  measure: 2,
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const DRAWING_COLORS = ['#5aa2e6', '#f5b13b', '#22d39a', '#fb5168', '#a855f7', '#e9eef7'];

export function newDrawingId(): string {
  return `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ----- Geometry (pure, tested) ----------------------------------------

/** Distance from point (px,py) to the segment (ax,ay)-(bx,by), in pixels. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Fib retracement level prices between two anchor prices (p0 = 0, p1 = 1). */
export function fibLevelPrices(p0: number, p1: number): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({ level, price: p0 + (p1 - p0) * level }));
}

export function isDrawing(v: unknown): v is Drawing {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.type === 'string' &&
    Array.isArray(d.points) &&
    d.points.every((p) => p && typeof (p as DPoint).time === 'number' && typeof (p as DPoint).price === 'number') &&
    typeof d.color === 'string'
  );
}

// ----- Per-symbol reactive store --------------------------------------

type Store = Record<string, Drawing[]>;
const KEY = 'btc-mood:drawings:v1';

let cache: Store | null = null;
const listeners = new Set<() => void>();
const EMPTY: Drawing[] = [];

function loadAll(): Store {
  if (cache) return cache;
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const out: Store = {};
    if (parsed && typeof parsed === 'object') {
      for (const [sym, list] of Object.entries(parsed)) {
        if (Array.isArray(list)) out[sym] = list.filter(isDrawing);
      }
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function saveAll(next: Store) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function getDrawings(symbol: string): Drawing[] {
  return loadAll()[symbol] ?? EMPTY;
}

export function addDrawing(symbol: string, drawing: Drawing) {
  const all = loadAll();
  saveAll({ ...all, [symbol]: [...(all[symbol] ?? []), drawing] });
}

export function updateDrawing(symbol: string, id: string, patch: Partial<Drawing>) {
  const all = loadAll();
  const list = all[symbol] ?? [];
  saveAll({ ...all, [symbol]: list.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
}

export function removeDrawing(symbol: string, id: string) {
  const all = loadAll();
  const list = all[symbol] ?? [];
  saveAll({ ...all, [symbol]: list.filter((d) => d.id !== id) });
}

export function clearDrawings(symbol: string) {
  const all = loadAll();
  if (!all[symbol] || all[symbol].length === 0) return;
  saveAll({ ...all, [symbol]: [] });
}

export function useDrawings(symbol: string): Drawing[] {
  const all = useSyncExternalStore(subscribe, () => cache ?? loadAll(), () => ({}) as Store);
  return all[symbol] ?? EMPTY;
}
