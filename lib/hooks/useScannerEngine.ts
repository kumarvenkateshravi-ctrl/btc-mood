'use client';

// Technical Scanner — page-level engine hook: computes the snapshot (cached
// on closed bars + strategy revision inside the engine) and publishes it for
// the chart overlay indicator and the signal dock. Re-runs per candle change;
// the engine's internal cache makes intrabar ticks O(1).

import { useMemo } from 'react';
import type { Candle, Timeframe } from '../types';
import { computeScannerSnapshot, takeFreshSignals, type ScannerSnapshot } from '../scanner/engine';
import { publishScannerSnapshot } from '../scanner/scannerUiStore';
import { TF_SECONDS } from '../scanner/evaluate';

/** Alerts-lite: browser notification for a signal that just fired live. */
function notifyFresh(snap: ScannerSnapshot, candles: Candle[] | undefined, evalTf: Timeframe): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!candles || candles.length < 2) return;
  const lastClosed = candles[candles.length - 2].time + TF_SECONDS[evalTf];
  const fresh = takeFreshSignals(snap, lastClosed, TF_SECONDS[evalTf]);
  if (fresh.length === 0) return;
  if (Notification.permission === 'default') { void Notification.requestPermission(); return; }
  if (Notification.permission !== 'granted') return;
  for (const s of fresh) {
    const name = snap.byStrategy[s.strategyId]?.name ?? s.strategyId;
    try {
      new Notification(`${s.side === 'buy' ? 'BUY' : 'SELL'} · ${name}`, {
        body: `Entry ${s.entry.toFixed(1)} · SL ${s.stopLoss.toFixed(1)} · TP1 ${s.tp1.toFixed(1)} · conf ${s.confidence}`,
        tag: s.id, // dedupe at the OS level too
      });
    } catch { /* notification blocked — non-fatal */ }
  }
}

export function useScannerEngine(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): ScannerSnapshot {
  return useMemo(() => {
    const snap = computeScannerSnapshot(candlesByTf, evalTf);
    publishScannerSnapshot(snap);
    notifyFresh(snap, candlesByTf[evalTf], evalTf);
    return snap;
  }, [candlesByTf, evalTf]);
}
