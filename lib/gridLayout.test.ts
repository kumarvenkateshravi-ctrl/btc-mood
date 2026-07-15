// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_LAYOUT,
  LAYOUT_CONFIGS,
  LAYOUT_COUNTS,
  isLayoutCount,
  isLayoutMode,
  getLayoutConfig,
  layoutConfigKey,
  loadLayout,
  saveLayout,
  markMigrationToastShown,
  wasMigrationToastShown,
  reconcileGridTfs,
  tfsForCount,
  tfsForPanes,
  isSyncActive,
  type Layout,
  type LayoutMode,
  GRID_COLS_CLASS,
} from './gridLayout';

const STORAGE_KEY_V2 = 'btc-mood:chart-grid:v2';
const STORAGE_KEY_V1 = 'btc-mood:chart-grid:v1';
const MIGRATION_FLAG_KEY = 'btc-mood:chart-grid:v2-migrated';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

// ---------------- v1 constants ----------------

describe('LAYOUT_COUNTS / type guards', () => {
  it('exposes [1, 2, 4] for v1', () => {
    expect(LAYOUT_COUNTS).toEqual([1, 2, 4]);
  });

  it('isLayoutCount accepts only the allowed values', () => {
    expect(isLayoutCount(1)).toBe(true);
    expect(isLayoutCount(2)).toBe(true);
    expect(isLayoutCount(4)).toBe(true);
    expect(isLayoutCount(3)).toBe(false);
    expect(isLayoutCount(6)).toBe(false);
    expect(isLayoutCount(8)).toBe(false);
  });

  it('isLayoutMode accepts single, multi-chart, multi-pane', () => {
    expect(isLayoutMode('single')).toBe(true);
    expect(isLayoutMode('multi-chart')).toBe(true);
    expect(isLayoutMode('multi-pane')).toBe(true);
    expect(isLayoutMode('grid')).toBe(false);
  });
});

// ---------------- LAYOUT_CONFIGS ----------------

describe('LAYOUT_CONFIGS', () => {
  it('exposes the 5 v1 combinations', () => {
    const keys = Object.keys(LAYOUT_CONFIGS).sort();
    expect(keys).toEqual([
      'multi-chart::2',
      'multi-chart::4',
      'multi-pane::2',
      'multi-pane::4',
      'single::1',
    ]);
  });

  it('does not expose single::2 or single::4 (illegal combinations)', () => {
    expect(LAYOUT_CONFIGS['single::2']).toBeUndefined();
    expect(LAYOUT_CONFIGS['single::4']).toBeUndefined();
  });

  it('thumbnail rows × cols matches filled.length', () => {
    for (const cfg of Object.values(LAYOUT_CONFIGS)) {
      expect(cfg.thumbnail.filled.length).toBe(cfg.thumbnail.rows * cfg.thumbnail.cols);
    }
  });
});

describe('layoutConfigKey / getLayoutConfig', () => {
  it('builds the canonical key', () => {
    expect(layoutConfigKey('single', 1)).toBe('single::1');
    expect(layoutConfigKey('multi-pane', 4)).toBe('multi-pane::4');
  });

  it('returns the config for valid (mode, count) pairs', () => {
    expect(getLayoutConfig('single', 1)?.render).toBe('single');
    expect(getLayoutConfig('multi-chart', 4)?.render).toBe('multi-chart');
    expect(getLayoutConfig('multi-pane', 2)?.render).toBe('multi-pane');
  });

  it('returns null for invalid (mode, count) pairs', () => {
    expect(getLayoutConfig('single', 2)).toBeNull();
    expect(getLayoutConfig('multi-pane', 1)).toBeNull();
  });
});

// ---------------- DEFAULT_LAYOUT ----------------

describe('DEFAULT_LAYOUT', () => {
  it('has the expected shape', () => {
    expect(DEFAULT_LAYOUT).toEqual({
      mode: 'single',
      count: 1,
      sync: {
        symbol: true,
        interval: true,
        crosshair: false,
        time: false,
        dateRange: false,
      },
    });
  });

  it('crosshair / time / dateRange default OFF (TV default)', () => {
    expect(DEFAULT_LAYOUT.sync.crosshair).toBe(false);
    expect(DEFAULT_LAYOUT.sync.time).toBe(false);
    expect(DEFAULT_LAYOUT.sync.dateRange).toBe(false);
  });
});

// ---------------- tfsForCount / reconcileGridTfs ----------------

describe('tfsForCount', () => {
  it('count=1 returns the 15m default', () => {
    expect(tfsForCount(1, '15m')).toEqual(['15m']);
  });

  it('count=2 returns 15m + 1h when the user is on a default TF', () => {
    expect(tfsForCount(2, '15m')).toEqual(['15m', '1h']);
  });

  it('count=4 returns the full ladder', () => {
    expect(tfsForCount(4, '15m')).toEqual(['15m', '1h', '4h', '1d']);
  });

  it('pins the user-selected TF to slot 0 when not in the ladder', () => {
    // 5m is in the ladder, so it would stay; pick something exotic.
    // We don't have exotic TFs in the v1 set, so use the existing ladder logic.
    expect(tfsForCount(2, '5m')).toEqual(['5m', '15m']);
  });
});

describe('reconcileGridTfs', () => {
  it('returns previous unchanged when length matches count', () => {
    expect(reconcileGridTfs(['15m', '1h'], 2, '15m')).toEqual(['15m', '1h']);
  });

  it('grows from defaults when previous is empty', () => {
    expect(reconcileGridTfs([], 4, '15m')).toEqual(['15m', '1h', '4h', '1d']);
  });

  it('shrinks by truncation when count shrinks', () => {
    expect(reconcileGridTfs(['15m', '1h', '4h', '1d'], 2, '15m')).toEqual(['15m', '1h']);
  });

  it('grows by appending defaults not already present', () => {
    // count=2 with a previous of ['5m'] drops the default ladder
    // (15m, 1h) into the remaining slot.
    expect(reconcileGridTfs(['5m'], 2, '5m')).toEqual(['5m', '15m']);
  });
});

describe('tfsForPanes', () => {
  it('returns N copies of the selected TF (v1 behavior)', () => {
    expect(tfsForPanes(2, '15m')).toEqual(['15m', '15m']);
    expect(tfsForPanes(4, '1h')).toEqual(['1h', '1h', '1h', '1h']);
  });
});

// ---------------- isSyncActive ----------------

describe('isSyncActive', () => {
  const baseLayout = (mode: LayoutMode, syncFlags: Partial<Layout['sync']> = {}): Layout => ({
    mode,
    count: mode === 'single' ? 1 : 2,
    sync: { ...DEFAULT_LAYOUT.sync, ...syncFlags },
  });

  it('multi-pane: time / crosshair / dateRange are always true (LWC free)', () => {
    const l = baseLayout('multi-pane', { time: false, crosshair: false, dateRange: false });
    expect(isSyncActive(l, 'time')).toBe(true);
    expect(isSyncActive(l, 'crosshair')).toBe(true);
    expect(isSyncActive(l, 'dateRange')).toBe(true);
  });

  it('multi-chart: time / crosshair / dateRange follow the user flag', () => {
    const on = baseLayout('multi-chart', { time: true, crosshair: true, dateRange: true });
    const off = baseLayout('multi-chart', { time: false, crosshair: false, dateRange: false });
    expect(isSyncActive(on, 'time')).toBe(true);
    expect(isSyncActive(off, 'time')).toBe(false);
    expect(isSyncActive(on, 'crosshair')).toBe(true);
    expect(isSyncActive(off, 'crosshair')).toBe(false);
    expect(isSyncActive(on, 'dateRange')).toBe(true);
    expect(isSyncActive(off, 'dateRange')).toBe(false);
  });

  it('single: false for everything except symbol/interval (which are out of scope)', () => {
    const l = baseLayout('single');
    expect(isSyncActive(l, 'time')).toBe(false);
    expect(isSyncActive(l, 'crosshair')).toBe(false);
    expect(isSyncActive(l, 'dateRange')).toBe(false);
  });
});

// ---------------- persistence (v2) ----------------

describe('loadLayout', () => {
  it('returns DEFAULT_LAYOUT when nothing is stored', () => {
    expect(loadLayout().layout).toEqual(DEFAULT_LAYOUT);
  });

  it('round-trips a saved layout', () => {
    const layout: Layout = {
      mode: 'multi-pane',
      count: 4,
      sync: { ...DEFAULT_LAYOUT.sync, crosshair: true },
    };
    saveLayout(layout);
    expect(loadLayout().layout).toEqual(layout);
  });

  it('returns DEFAULT_LAYOUT when v2 is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY_V2, '{not json');
    expect(loadLayout().layout).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT when v2 has a bogus mode', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ schemaVersion: 2, mode: 'triple-pane', count: 4, sync: DEFAULT_LAYOUT.sync }),
    );
    expect(loadLayout().layout).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT when v2 has an unknown (mode, count) pair', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ schemaVersion: 2, mode: 'single', count: 2, sync: DEFAULT_LAYOUT.sync }),
    );
    expect(loadLayout().layout).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT when v2 has a non-boolean sync field', () => {
    const bad = {
      schemaVersion: 2,
      mode: 'multi-chart',
      count: 4,
      sync: { ...DEFAULT_LAYOUT.sync, time: 'yes' as unknown as boolean },
    };
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(bad));
    expect(loadLayout().layout).toEqual(DEFAULT_LAYOUT);
  });
});

// ---------------- v1 → v2 migration ----------------

describe('loadLayout: v1 → v2 migration', () => {
  it('migrates v1 count=1 to single, count=1, default sync', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 1, tfs: ['15m'] }),
    );
    const { layout, migrated } = loadLayout();
    expect(migrated).toBe(true);
    expect(layout).toEqual({ mode: 'single', count: 1, sync: DEFAULT_LAYOUT.sync });
  });

  it('migrates v1 count=2 to multi-chart, count=2', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 2, tfs: ['15m', '1h'] }),
    );
    const { layout, migrated } = loadLayout();
    expect(migrated).toBe(true);
    expect(layout.mode).toBe('multi-chart');
    expect(layout.count).toBe(2);
  });

  it('migrates v1 count=4 to multi-chart, count=4', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 4, tfs: ['15m', '1h', '4h', '1d'] }),
    );
    const { layout, migrated } = loadLayout();
    expect(migrated).toBe(true);
    expect(layout.mode).toBe('multi-chart');
    expect(layout.count).toBe(4);
  });

  it('folds v1 count=6 to multi-chart, count=4 (closest analog)', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 6, tfs: [] }),
    );
    const { layout, migrated } = loadLayout();
    expect(migrated).toBe(true);
    expect(layout.mode).toBe('multi-chart');
    expect(layout.count).toBe(4);
  });

  it('writes the migrated layout to v2 and clears v1', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 2, tfs: [] }),
    );
    loadLayout();
    expect(window.localStorage.getItem(STORAGE_KEY_V1)).toBeNull();
    const v2 = JSON.parse(window.localStorage.getItem(STORAGE_KEY_V2) ?? '{}');
    expect(v2.schemaVersion).toBe(2);
    expect(v2.count).toBe(2);
    expect(v2.mode).toBe('multi-chart');
  });

  it('returns DEFAULT_LAYOUT when v1 is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY_V1, '{bad');
    const { layout, migrated } = loadLayout();
    expect(migrated).toBe(false);
    expect(layout).toEqual(DEFAULT_LAYOUT);
  });

  it('returns DEFAULT_LAYOUT when v1 has an unknown count', () => {
    window.localStorage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify({ schemaVersion: 1, count: 99, tfs: [] }),
    );
    expect(loadLayout()).toEqual({ layout: DEFAULT_LAYOUT, migrated: false });
  });
});

// ---------------- saveLayout ----------------

describe('saveLayout', () => {
  it('persists the layout with schemaVersion 2', () => {
    const layout: Layout = {
      mode: 'multi-chart',
      count: 2,
      sync: { ...DEFAULT_LAYOUT.sync, time: true },
    };
    saveLayout(layout);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY_V2) ?? '{}');
    expect(stored.schemaVersion).toBe(2);
    expect(stored.mode).toBe('multi-chart');
    expect(stored.count).toBe(2);
    expect(stored.sync.time).toBe(true);
  });

  it('swallows quota errors silently', () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveLayout(DEFAULT_LAYOUT)).not.toThrow();
    window.localStorage.setItem = setItem;
  });
});

// ---------------- migration toast flag ----------------

describe('migration toast flag', () => {
  it('wasMigrationToastShown returns false initially', () => {
    expect(wasMigrationToastShown()).toBe(false);
  });

  it('markMigrationToastShown flips the flag', () => {
    markMigrationToastShown();
    expect(window.localStorage.getItem(MIGRATION_FLAG_KEY)).toBe('1');
    expect(wasMigrationToastShown()).toBe(true);
  });
});

describe('GRID_COLS_CLASS (multi-chart columns, count is ambiguous across modes)', () => {
  it('count 2 = 2 columns (multi-chart wins over multi-pane), not collapsed to 1', () => {
    expect(GRID_COLS_CLASS[2]).toBe('grid-cols-2');
  });
  it('count 4 = 2 columns (a 2x2 grid)', () => {
    expect(GRID_COLS_CLASS[4]).toBe('grid-cols-2');
  });
  it('the multi-chart configs themselves carry grid columns', () => {
    expect(LAYOUT_CONFIGS['multi-chart::2'].gridColsClass).toBe('grid-cols-2');
    expect(LAYOUT_CONFIGS['multi-chart::4'].gridColsClass).toBe('grid-cols-2');
  });
});
