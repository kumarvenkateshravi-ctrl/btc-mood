// Multi-pane grid layout — pure functions, no React, no DOM.
// The layout switcher lets the user pick from three modes:
//   - single       : one full-width chart (default)
//   - multi-chart  : N independent Chart instances laid out as a grid
//   - multi-pane   : one Chart with N LWC panes stacked vertically
// The (mode, count) pair is the key into LAYOUT_CONFIGS and the unit of
// persistence. Sync flags control whether range / crosshair / date range
// propagate across cells (multi-chart) or panes (multi-pane — LWC
// does this for free, so the flags are advisory in that mode).

import type { Timeframe } from './types';

// v1 only supports 1, 2, or 4. Higher counts (8/16) are exposed in the
// UI as "coming soon" with a lock icon.
export const LAYOUT_COUNTS = [1, 2, 4] as const;
export type LayoutCount = (typeof LAYOUT_COUNTS)[number];

export type LayoutMode = 'single' | 'multi-chart' | 'multi-pane';

export interface LayoutSync {
  /** Always on in v1 (single-symbol app). Surfaced for future per-cell symbol. */
  symbol: boolean;
  /** All cells / panes use the active TF in v1. */
  interval: boolean;
  /** When on, crosshair moves across all cells/panes. Default false. */
  crosshair: boolean;
  /** When on, the time scale (pan/zoom) is synced across all cells. Default false. */
  time: boolean;
  /** When on, the visible date range is shared. Default false. */
  dateRange: boolean;
}

export interface Layout {
  mode: LayoutMode;
  count: LayoutCount;
  sync: LayoutSync;
}

export interface LayoutConfig {
  count: LayoutCount;
  gridColsClass: string;
  render: 'single' | 'multi-chart' | 'multi-pane';
  label: string;
  /** Thumbnail preview: rows × cols grid of filled cells. */
  thumbnail: { rows: number; cols: number; filled: boolean[] };
}

/** Only valid (mode, count) combinations for v1. */
export const LAYOUT_CONFIGS: Record<string, LayoutConfig> = {
  'single::1': {
    count: 1, gridColsClass: 'grid-cols-1', render: 'single',
    label: 'Single chart',
    thumbnail: { rows: 1, cols: 1, filled: [true] },
  },
  'multi-chart::2': {
    count: 2, gridColsClass: 'grid-cols-2', render: 'multi-chart',
    label: '2 charts side-by-side',
    thumbnail: { rows: 1, cols: 2, filled: [true, true] },
  },
  'multi-chart::4': {
    count: 4, gridColsClass: 'grid-cols-2', render: 'multi-chart',
    label: '4 charts (2×2)',
    thumbnail: { rows: 2, cols: 2, filled: [true, true, true, true] },
  },
  'multi-pane::2': {
    count: 2, gridColsClass: 'grid-cols-1', render: 'multi-pane',
    label: '2 panes stacked',
    thumbnail: { rows: 2, cols: 1, filled: [true, true] },
  },
  'multi-pane::4': {
    count: 4, gridColsClass: 'grid-cols-1', render: 'multi-pane',
    label: '4 panes stacked',
    thumbnail: { rows: 4, cols: 1, filled: [true, true, true, true] },
  },
};

export const DEFAULT_LAYOUT: Layout = {
  mode: 'single',
  count: 1,
  sync: {
    symbol: true,
    interval: true,
    crosshair: false,
    time: false,
    dateRange: false,
  },
};

export function isLayoutCount(n: number): n is LayoutCount {
  return (LAYOUT_COUNTS as readonly number[]).includes(n);
}

export function isLayoutMode(s: string): s is LayoutMode {
  return s === 'single' || s === 'multi-chart' || s === 'multi-pane';
}

export function layoutConfigKey(mode: LayoutMode, count: LayoutCount): string {
  return `${mode}::${count}`;
}

export function getLayoutConfig(mode: LayoutMode, count: LayoutCount): LayoutConfig | null {
  return LAYOUT_CONFIGS[layoutConfigKey(mode, count)] ?? null;
}

/**
 * Timeframe assignment for multi-chart mode. Honors the user's selected
 * TF in slot 0 and fills the rest with the count's default ladder.
 */
export function tfsForCount(count: LayoutCount, selected: Timeframe): Timeframe[] {
  const defaults: Record<LayoutCount, Timeframe[]> = {
    1: ['15m'],
    2: ['15m', '1h'],
    4: ['15m', '1h', '4h', '1d'],
  };
  const ladder = defaults[count];
  if (ladder.includes(selected)) return ladder.slice();
  const out: Timeframe[] = [selected];
  for (const tf of ladder) {
    if (out.length >= count) break;
    if (!out.includes(tf)) out.push(tf);
  }
  while (out.length < count) {
    out.push(out[out.length - 1] ?? selected);
  }
  return out;
}

/** Reconcile a previous TF assignment to a new count. */
export function reconcileGridTfs(
  previous: Timeframe[],
  count: LayoutCount,
  selected: Timeframe,
): Timeframe[] {
  if (previous.length === count) return previous.slice();
  const defaults = tfsForCount(count, selected);
  if (previous.length === 0) return defaults;
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

/**
 * In v1, all panes in multi-pane mode show the same TF as the active
 * chart. The signature returns N copies of `selected` so the caller
 * can use a per-pane lookup if the UI later exposes a per-pane picker.
 */
export function tfsForPanes(count: LayoutCount, selected: Timeframe): Timeframe[] {
  return Array.from({ length: count }, () => selected);
}

/**
 * Returns whether the named sync behavior is active for a given layout.
 * In multi-pane mode, time / crosshair / dateRange are always synced
 * (LWC does it for free); the user flag is advisory only.
 */
export function isSyncActive(layout: Layout, key: keyof Omit<LayoutSync, 'symbol' | 'interval'>): boolean {
  if (layout.mode === 'multi-pane') return true;
  return layout.sync[key];
}

// ---------------- v1 back-compat aliases ----------------
// These keep the old (pre-Layout) consumers compiling while we migrate
// them to the new layout primitives. Safe to delete in a follow-up.

/** @deprecated use LAYOUT_COUNTS */
export const GRID_COUNTS = LAYOUT_COUNTS;
/** @deprecated use LayoutCount */
export type GridCount = LayoutCount;
/** @deprecated use DEFAULT_LAYOUT */
export const DEFAULT_GRID_COUNT: LayoutCount = 1;

/** @deprecated use LAYOUT_CONFIGS[*].gridColsClass */
export const GRID_COLS_CLASS: Record<LayoutCount, string> = (() => {
  const out: Partial<Record<LayoutCount, string>> = {};
  // Prefer the multi-CHART grid columns for a given count — count is not
  // unique across modes, and the pane configs (grid-cols-1) would otherwise
  // clobber the chart-grid columns. Callers wanting pane columns should read
  // LAYOUT_CONFIGS['multi-pane::N'] directly.
  for (const cfg of Object.values(LAYOUT_CONFIGS)) {
    if (out[cfg.count] == null || cfg.render === 'multi-chart') out[cfg.count] = cfg.gridColsClass;
  }
  return out as Record<LayoutCount, string>;
})();

/** @deprecated use loadLayout */
export function loadGrid(): { count: LayoutCount; tfs: import('./types').Timeframe[] } | null {
  const { layout } = loadLayout();
  if (layout.mode === 'single') {
    return { count: 1, tfs: tfsForCount(1, '15m') };
  }
  if (layout.mode === 'multi-chart') {
    return { count: layout.count, tfs: tfsForCount(layout.count, '15m') };
  }
  return { count: layout.count, tfs: tfsForPanes(layout.count, '15m') };
}

/** @deprecated use saveLayout */
export function saveGrid(state: { count: LayoutCount; tfs: import('./types').Timeframe[] }): void {
  const mode: LayoutMode = state.count === 1 ? 'single' : 'multi-chart';
  saveLayout({ mode, count: state.count, sync: DEFAULT_LAYOUT.sync });
}

// ---------------- persistence (v2 with v1 migrate) ----------------

const STORAGE_KEY_V2 = 'btc-mood:chart-grid:v2';
const STORAGE_KEY_V1 = 'btc-mood:chart-grid:v1';
const MIGRATION_FLAG_KEY = 'btc-mood:chart-grid:v2-migrated';
const SCHEMA_VERSION_V2 = 2;

interface StoredV2 {
  schemaVersion: number;
  mode: LayoutMode;
  count: LayoutCount;
  sync: LayoutSync;
}

interface StoredV1 {
  schemaVersion: number;
  count: number;
  tfs: unknown[];
}

const VALID_TFS = new Set<Timeframe>(['5m', '15m', '30m', '1h', '4h', '1d']);
function isTimeframe(s: string): s is Timeframe {
  return VALID_TFS.has(s as Timeframe);
}

function isValidV2(v: unknown): v is StoredV2 {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<StoredV2>;
  if (o.schemaVersion !== SCHEMA_VERSION_V2) return false;
  if (typeof o.mode !== 'string' || !isLayoutMode(o.mode)) return false;
  if (typeof o.count !== 'number' || !isLayoutCount(o.count)) return false;
  if (!o.sync || typeof o.sync !== 'object') return false;
  const s = o.sync as unknown as Record<string, unknown>;
  for (const k of ['symbol', 'interval', 'crosshair', 'time', 'dateRange'] as const) {
    if (typeof s[k] !== 'boolean') return false;
  }
  // The (mode, count) pair must be a known config.
  if (!getLayoutConfig(o.mode, o.count)) return false;
  return true;
}

function migrateV1ToV2(v1: StoredV1): Layout | null {
  // v1 had only 1/2/4/6 — fold 6 → 4.
  let count: LayoutCount | null = null;
  if (v1.count === 1) count = 1;
  else if (v1.count === 2) count = 2;
  else if (v1.count === 4) count = 4;
  else if (v1.count === 6) count = 4;
  if (count === null) return null;
  const mode: LayoutMode = count === 1 ? 'single' : 'multi-chart';
  return { mode, count, sync: { ...DEFAULT_LAYOUT.sync } };
}

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled */
  }
}

function clearKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

/**
 * Load the persisted layout. Returns the default when nothing valid is
 * stored. Performs a one-time v1→v2 migration when applicable.
 *
 * @returns The layout and a `migrated` flag indicating whether a v1
 * entry was just migrated to v2. The toast UI uses this to show the
 * "new layout options available" hint once per user.
 */
export function loadLayout(): { layout: Layout; migrated: boolean } {
  const empty = { layout: DEFAULT_LAYOUT, migrated: false };
  if (typeof window === 'undefined') return empty;

  const v2 = readJson(STORAGE_KEY_V2);
  if (isValidV2(v2)) {
    const { schemaVersion: _s, ...rest } = v2;
    return { layout: rest, migrated: false };
  }

  const v1 = readJson(STORAGE_KEY_V1);
  if (v1 && typeof v1 === 'object') {
    const migrated = migrateV1ToV2(v1 as StoredV1);
    if (migrated) {
      saveLayout(migrated);
      clearKey(STORAGE_KEY_V1);
      return { layout: migrated, migrated: true };
    }
  }

  return empty;
}

export function saveLayout(layout: Layout): void {
  if (typeof window === 'undefined') return;
  const stored: StoredV2 = {
    schemaVersion: SCHEMA_VERSION_V2,
    mode: layout.mode,
    count: layout.count,
    sync: layout.sync,
  };
  writeJson(STORAGE_KEY_V2, stored);
}

/**
 * Marks the migration toast as "shown" so it only appears once per
 * browser. Called by the layout-switcher mount effect.
 */
export function markMigrationToastShown(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MIGRATION_FLAG_KEY, '1');
  } catch {}
}

export function wasMigrationToastShown(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}
