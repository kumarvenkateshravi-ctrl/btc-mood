// Multi-pane grid layout — pure functions, no React, no DOM.
// The grid layout picker lets the user pick 1/2/4/6 panes; each pane
// shows a different timeframe for the active symbol. The CSS grid
// `data-count` attribute picks the column count; this module decides
// (a) which timeframes fill the panes and (b) how to persist them.

import type { Timeframe } from './types';

// btc-mood currently exposes 6 timeframes. 1/2/4 panes fit naturally;
// 6 fills the full set. 8+ would require extending TIMEFRAMES first —
// keep the cap at 6 until then.
export const GRID_COUNTS = [1, 2, 4, 6] as const;
export type GridCount = (typeof GRID_COUNTS)[number];

export const DEFAULT_GRID_COUNT: GridCount = 1;

// Default timeframe assignment per count. The first entry is always
// the user's currently-selected TF so the grid feels connected to the
// single-chart view. Excess entries follow vardhan's "fill in
// adjacent higher TFs first" pattern.
const DEFAULT_TFS_BY_COUNT: Record<GridCount, Timeframe[]> = {
  1: ['15m'],
  2: ['15m', '1h'],
  4: ['15m', '1h', '4h', '1d'],
  6: ['5m', '15m', '30m', '1h', '4h', '1d'],
};

// CSS class names emitted as the `data-count` attribute on the grid
// root. Tailwind doesn't support dynamic class names in `safelist`
// without extra config, so we emit literal class strings here.
export const GRID_COLS_CLASS: Record<GridCount, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  4: 'grid-cols-2',
  6: 'grid-cols-2 lg:grid-cols-3',
};

/** True iff the count is one of the allowed values. */
export function isGridCount(n: number): n is GridCount {
  return (GRID_COUNTS as readonly number[]).includes(n);
}

/**
 * Build the ordered list of timeframes for a given count. Honors the
 * currently-selected TF (pinned in slot 0) and fills the rest with
 * the count's default ladder.
 */
export function tfsForCount(count: GridCount, selected: Timeframe): Timeframe[] {
  const defaults = DEFAULT_TFS_BY_COUNT[count];
  // If the user is already looking at a TF in the default ladder,
  // use the default ladder as-is so cells stay grouped logically.
  if (defaults.includes(selected)) return defaults.slice();
  // Otherwise pin `selected` to slot 0 and rotate the rest, dropping
  // duplicates so the cell count stays exact.
  const out: Timeframe[] = [selected];
  for (const tf of defaults) {
    if (out.length >= count) break;
    if (!out.includes(tf)) out.push(tf);
  }
  // If we still don't have enough (e.g. count=6 but only 6 distinct
  // TFs total), pad with the highest available TF.
  while (out.length < count) {
    const last = out[out.length - 1];
    out.push(last);
  }
  return out;
}

/**
 * Given a previous TF assignment and a new count, return the
 * closest valid TF list — preserve as many of the previous panes as
 * possible, falling back to defaults for slots that don't fit.
 */
export function reconcileGridTfs(
  previous: Timeframe[],
  count: GridCount,
  selected: Timeframe,
): Timeframe[] {
  if (previous.length === count) return previous.slice();
  const defaults = tfsForCount(count, selected);
  if (previous.length === 0) return defaults;
  // Keep as many previous cells as fit, then fill the rest from the
  // default ladder.
  const out: Timeframe[] = previous.slice(0, count);
  for (const tf of defaults) {
    if (out.length >= count) break;
    if (!out.includes(tf)) out.push(tf);
  }
  while (out.length < count) {
    out.push(out[out.length - 1] ?? selected);
  }
  return out;
}

const STORAGE_KEY = 'btc-mood:chart-grid:v1';
const SCHEMA_VERSION = 1;

export interface PersistedGrid {
  count: GridCount;
  tfs: Timeframe[];
}

interface StoredGrid {
  schemaVersion: number;
  count: GridCount;
  tfs: Timeframe[];
}

/**
 * Load the persisted grid from localStorage. Returns null on any
 * failure (missing key, parse error, schema mismatch, invalid shape).
 * Schema-version bumps intentionally discard stale state.
 */
export function loadGrid(): PersistedGrid | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const v = parsed as Partial<StoredGrid>;
    if (v.schemaVersion !== SCHEMA_VERSION) return null;
    if (typeof v.count !== 'number' || !isGridCount(v.count)) return null;
    if (!Array.isArray(v.tfs)) return null;
    const tfs = v.tfs.filter(
      (x): x is Timeframe => typeof x === 'string' && isTimeframe(x),
    );
    return { count: v.count, tfs };
  } catch {
    return null;
  }
}

export function saveGrid(state: PersistedGrid): void {
  if (typeof window === 'undefined') return;
  try {
    const stored: StoredGrid = {
      schemaVersion: SCHEMA_VERSION,
      count: state.count,
      tfs: state.tfs,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota or disabled storage — silently drop.
  }
}

const VALID_TFS = new Set<Timeframe>([
  '5m', '15m', '30m', '1h', '4h', '1d',
]);
function isTimeframe(s: string): s is Timeframe {
  return VALID_TFS.has(s as Timeframe);
}