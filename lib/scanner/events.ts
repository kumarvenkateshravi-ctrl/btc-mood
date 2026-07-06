// Technical Scanner — append-only event timeline (Rule 3). Every action is an
// immutable event with a deterministic eventId, the CLOSE time of the bar
// where it occurred, and (on creation events) the frozen Why? snapshot.
// Events are DERIVED deterministically from signals + walked trades, so the
// timeline is reconstructable from history at any time.

import type { Candle, Timeframe } from '../types';
import type { VdTrade } from '../indicators/vdEngine';
import { TF_SECONDS } from './evaluate';
import type { ConditionSnapshot } from './types';
import type { ScannerSignal } from './signals';

export type ScannerEventType =
  | 'StrategyMatched' | 'SignalCreated' | 'TradeOpened'
  | 'TP1Hit' | 'TP2Hit' | 'TP3Hit' | 'Stopped' | 'ContextExit'
  | 'TradeClosed';

export interface ScannerEvent {
  eventId: string;            // `${signalId}#${eventType}` — deterministic, unique
  signalId: string;
  strategyVersionId: string;
  eventType: ScannerEventType;
  barTime: number;            // CLOSE time of the bar where it occurred
  createdAt: number;          // wall-clock when first recorded
  price?: number;             // fill/exit price where applicable
  explainSnapshot?: ConditionSnapshot[]; // frozen Why? (creation events)
}

/** Derive the full event timeline for walked scanner trades. */
export function deriveScannerEvents(
  trades: Array<VdTrade<ScannerSignal>>,
  candles: Candle[],
  tf: Timeframe,
  now: number = Date.now(),
): ScannerEvent[] {
  const dur = TF_SECONDS[tf];
  const closeTime = (i: number | undefined | null): number | null =>
    i != null && candles[i] ? candles[i].time + dur : null;
  const out: ScannerEvent[] = [];

  for (const t of trades) {
    const s = t.signal;
    const ev = (
      eventType: ScannerEventType,
      barTime: number | null,
      price?: number,
      explainSnapshot?: ConditionSnapshot[],
    ) => {
      if (barTime == null) return;
      out.push({
        eventId: `${s.id}#${eventType}`,
        signalId: s.id,
        strategyVersionId: s.strategyVersionId,
        eventType, barTime, createdAt: now,
        ...(price != null ? { price } : {}),
        ...(explainSnapshot ? { explainSnapshot } : {}),
      });
    };

    ev('StrategyMatched', s.barTime, undefined, s.why);
    ev('SignalCreated', s.barTime, s.entry, s.why);
    ev('TradeOpened', s.barTime, s.entry);
    ev('TP1Hit', closeTime(t.tp1Index), s.tp1);
    ev('TP2Hit', closeTime(t.tp2Index), s.tp2);
    ev('TP3Hit', closeTime(t.tp3Index), s.tp3);
    if (t.status === 'stopped') ev('Stopped', closeTime(t.resolvedIndex), t.exitPrice ?? undefined);
    if (t.status === 'exit') ev('ContextExit', closeTime(t.resolvedIndex), t.exitPrice ?? undefined);
    if (t.resolvedIndex != null) ev('TradeClosed', closeTime(t.resolvedIndex), t.exitPrice ?? undefined);
  }

  const ORDER: Record<ScannerEventType, number> = {
    StrategyMatched: 0, SignalCreated: 1, TradeOpened: 2,
    TP1Hit: 3, TP2Hit: 4, TP3Hit: 5, Stopped: 6, ContextExit: 7, TradeClosed: 8,
  };
  return out.sort((a, b) =>
    a.barTime - b.barTime || ORDER[a.eventType] - ORDER[b.eventType] || a.signalId.localeCompare(b.signalId));
}
