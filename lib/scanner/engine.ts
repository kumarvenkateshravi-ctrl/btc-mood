// Technical Scanner — live engine snapshot: for every ENABLED strategy,
// generate deterministic signals over closed candles, walk their trades, and
// derive the event timeline. Cached on a closed-bar + strategy-revision
// signature (Rule 1: only a bar close or a strategy change triggers work).
// The page hook publishes this snapshot; the chart indicator and the signal
// dock are pure views of it.

import type { Candle, Timeframe } from '../types';
import { walkVdTrades, type VdTrade } from '../indicators/vdEngine';
import { generateScannerSignals, type ScannerSignal } from './signals';
import { deriveScannerEvents, type ScannerEvent } from './events';
import {
  listStrategies, recordSignals, recordEvents, scannerRevision,
} from './scannerStore';

export interface ScannerSnapshot {
  evalTf: Timeframe;
  signals: ScannerSignal[];                       // all enabled strategies, chronological
  trades: Array<VdTrade<ScannerSignal>>;          // walked on closed eval-TF candles
  events: ScannerEvent[];
  byStrategy: Record<string, { name: string; chartVisible: boolean }>;
}

const EMPTY: ScannerSnapshot = { evalTf: '15m', signals: [], trades: [], events: [], byStrategy: {} };

let _cacheKey = '';
let _cached: ScannerSnapshot = EMPTY;

export function computeScannerSnapshot(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
  now: number = Date.now(),
): ScannerSnapshot {
  const candles = candlesByTf[evalTf];
  if (!candles || candles.length < 2) return { ...EMPTY, evalTf };
  const closed = candles.slice(0, candles.length - 1); // never the forming bar
  const key = `${evalTf}|${closed.length}|${closed[0].time}|${closed[closed.length - 1].time}|rev${scannerRevision()}`;
  if (key === _cacheKey) return _cached;

  const strategies = listStrategies().filter((s) => s.enabled && !s.archived);
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as Array<[Timeframe, Candle[]]>) {
    if (arr && arr.length > 1) closedByTf[tf] = arr.slice(0, arr.length - 1);
  }

  const signals: ScannerSignal[] = [];
  const trades: Array<VdTrade<ScannerSignal>> = [];
  const byStrategy: ScannerSnapshot['byStrategy'] = {};
  for (const strat of strategies) {
    const sigs = generateScannerSignals(strat, closedByTf, evalTf, now);
    signals.push(...sigs);
    trades.push(...walkVdTrades(closed, sigs));
    byStrategy[strat.id] = { name: strat.name, chartVisible: strat.chartVisible !== false };
  }
  signals.sort((a, b) => a.index - b.index);
  trades.sort((a, b) => a.entryIndex - b.entryIndex);
  const events = deriveScannerEvents(trades, closed, evalTf, now);

  // Append-only history (Rule 3/4): recorded once, never edited.
  recordSignals(signals);
  recordEvents(events);

  _cacheKey = key;
  _cached = { evalTf, signals, trades, events, byStrategy };
  return _cached;
}

// ---- Alerts-lite: detect signals that just fired at the live edge -----------

const _alerted = new Set<string>();

/** Signals whose trigger bar closed within the last `windowBars` eval bars and
 *  that have not been alerted yet in this session. Pure diff — the caller
 *  decides how to notify. */
export function takeFreshSignals(
  snapshot: ScannerSnapshot,
  lastClosedTime: number,
  tfSeconds: number,
  windowBars = 2,
): ScannerSignal[] {
  const cutoff = lastClosedTime - windowBars * tfSeconds;
  const fresh = snapshot.signals.filter((s) => s.barTime > cutoff && !_alerted.has(s.id));
  for (const s of fresh) _alerted.add(s.id);
  if (_alerted.size > 1000) _alerted.clear();
  return fresh;
}

/** Test-only. */
export function __resetAlertedForTest(): void {
  _alerted.clear();
}
