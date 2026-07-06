'use client';

// Technical Scanner — page-level engine hook: computes the snapshot (cached
// on closed bars + strategy revision inside the engine) and publishes it for
// the chart overlay indicator and the signal dock. Re-runs per candle change;
// the engine's internal cache makes intrabar ticks O(1).

import { useMemo } from 'react';
import type { Candle, Timeframe } from '../types';
import { computeScannerSnapshot, type ScannerSnapshot } from '../scanner/engine';
import { publishScannerSnapshot } from '../scanner/scannerUiStore';

export function useScannerEngine(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): ScannerSnapshot {
  return useMemo(() => {
    const snap = computeScannerSnapshot(candlesByTf, evalTf);
    publishScannerSnapshot(snap);
    return snap;
  }, [candlesByTf, evalTf]);
}
