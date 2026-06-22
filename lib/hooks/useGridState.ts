'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Timeframe } from '../types';
import {
  DEFAULT_GRID_COUNT,
  loadGrid,
  reconcileGridTfs,
  saveGrid,
  tfsForCount,
  type GridCount,
} from '../gridLayout';

export interface GridState {
  gridCount: GridCount;
  gridTfs: Timeframe[];
  setGridCount: React.Dispatch<React.SetStateAction<GridCount>>;
  handleGridCountChange: (n: GridCount) => void;
}

/**
 * Multi-pane grid state: the user-pickable count (1/2/4/6) and the
 * ordered list of timeframes filling the cells. Hydrates from
 * localStorage on mount and persists on every change.
 */
export function useGridState(selected: Timeframe): GridState {
  const [gridCount, setGridCount] = useState<GridCount>(DEFAULT_GRID_COUNT);
  const [gridTfs, setGridTfs] = useState<Timeframe[]>(
    tfsForCount(DEFAULT_GRID_COUNT, selected),
  );

  const handleGridCountChange = useCallback(
    (n: GridCount) => {
      setGridTfs((tfs) => reconcileGridTfs(tfs, n, selected));
      setGridCount(n);
    },
    [selected],
  );

  // Hydrate from localStorage once.
  useEffect(() => {
    const persisted = loadGrid();
    if (persisted) {
      setGridCount(persisted.count);
      setGridTfs(reconcileGridTfs(persisted.tfs, persisted.count, selected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change.
  useEffect(() => {
    saveGrid({ count: gridCount, tfs: gridTfs });
  }, [gridCount, gridTfs]);

  return { gridCount, gridTfs, setGridCount, handleGridCountChange };
}
