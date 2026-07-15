'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Timeframe } from '../types';
import {
  DEFAULT_LAYOUT,
  isSyncActive,
  loadLayout,
  reconcileGridTfs,
  saveLayout,
  tfsForCount,
  type Layout,
  type LayoutCount,
} from '../gridLayout';

export interface GridState {
  /** Current layout (mode + count + sync). */
  layout: Layout;
  /** Ordered list of TFs for multi-chart mode. */
  gridTfs: Timeframe[];
  setLayout: React.Dispatch<React.SetStateAction<Layout>>;
  /** Back-compat: returns the count for legacy callers. */
  gridCount: LayoutCount;
  setGridCount: React.Dispatch<React.SetStateAction<LayoutCount>>;
  /** Back-compat handler for the old GridChip onChange. */
  handleGridCountChange: (n: LayoutCount) => void;
  /** True once on mount when the layout was migrated from v1 storage. */
  migrated: boolean;
  /** The user's pre-migration count (v1) — used by the migration toast. */
  previousCount: number;
}

/**
 * Layout state: the (mode, count, sync) tuple plus the per-cell TF
 * list for multi-chart mode. Hydrates from localStorage on mount and
 * persists on every change.
 *
 * The `gridCount` / `setGridCount` / `handleGridCountChange` surface is
 * preserved for back-compat with the existing `GridChip` and the
 * `useKeyboardShortcuts` "G" key. They operate on the `count` field of
 * the layout, defaulting `mode` to `multi-chart` when the user goes
 * from single to a higher count.
 */
export function useGridState(selected: Timeframe): GridState {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [gridTfs, setGridTfs] = useState<Timeframe[]>(
    tfsForCount(DEFAULT_LAYOUT.count, selected),
  );
  const [migrated, setMigrated] = useState(false);
  const [previousCount, setPreviousCount] = useState(0);

  const handleGridCountChange = useCallback(
    (n: LayoutCount) => {
      setLayout((prev) => {
        // Map old "set count" semantics onto the new model.
        // Single-chart layout stays single; everything else becomes multi-chart.
        const nextMode = n === 1 ? 'single' : 'multi-chart';
        return {
          ...prev,
          mode: nextMode,
          count: n,
        };
      });
      setGridTfs((tfs) => reconcileGridTfs(tfs, n, selected));
    },
    [selected],
  );

  // Hydrate from localStorage once.
  useEffect(() => {
    const { layout: persisted, migrated: didMigrate } = loadLayout();
    setLayout(persisted);
    setMigrated(didMigrate);
    // We can't recover the v1 count from the v2 layout (it was folded
    // into a single canonical state), so the migration toast only shows
    // a generic message; the toast helper checks the flag.
    if (didMigrate) {
      // Heuristic: if the user ended up in multi-chart with count >= 2,
      // they almost certainly had a multi-cell v1. (v1 count=1 would
      // have migrated to single, which the toast skips.)
      setPreviousCount(persisted.count);
    }
    if (persisted.mode === 'multi-chart') {
      setGridTfs(reconcileGridTfs([], persisted.count, selected));
    } else if (persisted.mode === 'multi-pane') {
      // Multi-pane uses one TF replicated; not stored per-cell in v1.
      setGridTfs(tfsForCount(persisted.count, selected));
    } else {
      setGridTfs(tfsForCount(1, selected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change.
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  // Derived: the legacy `gridCount` is the layout's count regardless of mode.
  // The legacy `setGridCount` is provided for direct compat.
  const gridCount = layout.count;
  const setGridCount: React.Dispatch<React.SetStateAction<LayoutCount>> = (updater) => {
    const next = typeof updater === 'function'
      ? (updater as (prev: LayoutCount) => LayoutCount)(layout.count)
      : updater;
    setLayout((prev) => {
      const nextMode = next === 1 ? 'single' : 'multi-chart';
      return { ...prev, mode: nextMode, count: next };
    });
    setGridTfs((tfs) => reconcileGridTfs(tfs, next, selected));
  };

  return {
    layout,
    gridTfs,
    setLayout,
    gridCount,
    setGridCount,
    handleGridCountChange,
    migrated,
    previousCount,
  };
}

// Re-export the sync helper so consumers don't need a second import.
export { isSyncActive };
