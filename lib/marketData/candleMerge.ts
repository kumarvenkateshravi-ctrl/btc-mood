import type { Candle, Timeframe } from '../types';

export type CandleSource = 'websocket' | 'rest';
export type CandleMergeAction = 'none' | 'append' | 'update' | 'prepend' | 'repair';
export type CandleRejectReason =
  | 'duplicate'
  | 'older_event'
  | 'stale_symbol'
  | 'stale_timeframe'
  | 'stale_epoch'
  | 'out_of_order'
  | 'finalized'
  | 'rest_not_authorized';

export interface CanonicalWebSocketCandle {
  source: 'websocket';
  symbol: string;
  timeframe: Timeframe;
  candle: Candle;
  eventTimeMs: number;
  closed: boolean;
  connectionEpoch: number;
}

export interface CandleGap {
  fromOpenTime: number;
  toOpenTime: number;
  missingIntervals: number;
}

interface AcceptedCandleMeta {
  lastEventTimeMs: number;
  lastEventIdentity: string;
  finalized: boolean;
  source: CandleSource;
}

export interface CandleMergeState {
  symbol: string;
  timeframe: Timeframe;
  connectionEpoch: number;
  candles: readonly Candle[];
  gaps: readonly CandleGap[];
  meta: Readonly<Record<number, AcceptedCandleMeta>>;
}

export interface CandleMergeResult {
  state: CandleMergeState;
  accepted: boolean;
  action: CandleMergeAction;
  reason?: CandleRejectReason;
  candle?: Candle;
  gap: CandleGap | null;
}

export interface RestMergeOptions {
  receivedAtMs: number;
  /** Only explicit repair code may alter a finalized candle. */
  allowFinalizedRepair?: boolean;
}

function sameGap(left: CandleGap, right: CandleGap): boolean {
  return left.fromOpenTime === right.fromOpenTime
    && left.toOpenTime === right.toOpenTime
    && left.missingIntervals === right.missingIntervals;
}

/** Removes a repaired discontinuity after continuity has been independently verified. */
export function resolveCandleGap(state: CandleMergeState, repaired: CandleGap): CandleMergeState {
  const gaps = state.gaps.filter((gap) => !sameGap(gap, repaired));
  return gaps.length === state.gaps.length ? state : { ...state, gaps };
}

const INTERVAL_SECONDS: Record<Timeframe, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};

export function timeframeIntervalSeconds(timeframe: Timeframe): number {
  return INTERVAL_SECONDS[timeframe];
}

function candleIdentity(event: CanonicalWebSocketCandle): string {
  const { candle } = event;
  return [
    event.connectionEpoch,
    candle.time,
    event.eventTimeMs,
    event.closed ? 1 : 0,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.takerBuyVolume ?? '',
  ].join(':');
}

function emptyResult(state: CandleMergeState, reason: CandleRejectReason): CandleMergeResult {
  return { state, accepted: false, action: 'none', reason, gap: null };
}

function dedupeAndSort(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function sameCandle(left: Candle, right: Candle): boolean {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume
    && left.takerBuyVolume === right.takerBuyVolume;
}

function nextState(
  state: CandleMergeState,
  candles: readonly Candle[],
  meta: Readonly<Record<number, AcceptedCandleMeta>>,
  gap?: CandleGap,
): CandleMergeState {
  const gaps = gap ? [...state.gaps, gap] : state.gaps;
  return { ...state, candles, meta, gaps };
}

export function createCandleMergeState({
  symbol,
  timeframe,
  candles = [],
}: {
  symbol: string;
  timeframe: Timeframe;
  candles?: readonly Candle[];
}): CandleMergeState {
  const normalized = dedupeAndSort(candles);
  const meta: Record<number, AcceptedCandleMeta> = {};
  for (const candle of normalized) {
    meta[candle.time] = {
      lastEventTimeMs: 0,
      lastEventIdentity: `rest:${candle.time}`,
      finalized: false,
      source: 'rest',
    };
  }
  return { symbol, timeframe, connectionEpoch: 0, candles: normalized, gaps: [], meta };
}

/** Advances the accepted websocket epoch; older callback events are rejected. */
export function setCandleMergeEpoch(state: CandleMergeState, connectionEpoch: number): CandleMergeState {
  if (connectionEpoch <= state.connectionEpoch) return state;
  return { ...state, connectionEpoch };
}

/**
 * Applies one validated websocket event using server-event ordering, not
 * arrival order. The chart only ever receives a non-regressing tail update.
 */
export function acceptWebSocketCandle(state: CandleMergeState, event: CanonicalWebSocketCandle): CandleMergeResult {
  if (event.symbol !== state.symbol) return emptyResult(state, 'stale_symbol');
  if (event.timeframe !== state.timeframe) return emptyResult(state, 'stale_timeframe');
  if (event.connectionEpoch !== state.connectionEpoch) return emptyResult(state, 'stale_epoch');

  const identity = candleIdentity(event);
  const candles = state.candles;
  const last = candles.at(-1);
  const existingMeta = state.meta[event.candle.time];

  if (existingMeta?.lastEventIdentity === identity) return emptyResult(state, 'duplicate');
  if (existingMeta?.source === 'websocket' && event.eventTimeMs <= existingMeta.lastEventTimeMs) {
    return emptyResult(state, 'older_event');
  }
  if (last && event.candle.time < last.time) return emptyResult(state, 'out_of_order');
  if (existingMeta?.finalized) return emptyResult(state, 'finalized');

  const metadata: AcceptedCandleMeta = {
    lastEventTimeMs: event.eventTimeMs,
    lastEventIdentity: identity,
    finalized: event.closed,
    source: 'websocket',
  };
  const meta = { ...state.meta, [event.candle.time]: metadata };

  if (!last) {
    const next = nextState(state, [event.candle], meta);
    return { state: next, accepted: true, action: 'append', candle: event.candle, gap: null };
  }

  if (event.candle.time > last.time) {
    const interval = INTERVAL_SECONDS[state.timeframe];
    const difference = event.candle.time - last.time;
    const gap = difference > interval
      ? {
          fromOpenTime: last.time,
          toOpenTime: event.candle.time,
          missingIntervals: Math.max(1, Math.floor(difference / interval) - 1),
        }
      : null;
    const next = nextState(state, [...candles, event.candle], meta, gap ?? undefined);
    return { state: next, accepted: true, action: 'append', candle: event.candle, gap };
  }

  // Same open time. Keep the original open, preserve accumulated extremes
  // and volume, and allow a newer close to move naturally in either direction.
  const merged: Candle = {
    ...last,
    open: last.open,
    high: Math.max(last.high, event.candle.high),
    low: Math.min(last.low, event.candle.low),
    close: event.candle.close,
    volume: Math.max(last.volume, event.candle.volume),
    takerBuyVolume: last.takerBuyVolume == null && event.candle.takerBuyVolume == null
      ? undefined
      : Math.max(last.takerBuyVolume ?? 0, event.candle.takerBuyVolume ?? 0),
  };
  const next = nextState(state, [...candles.slice(0, -1), merged], meta);
  return { state: next, accepted: true, action: 'update', candle: merged, gap: null };
}

/**
 * Merges a REST snapshot without allowing routine polling to overwrite live
 * websocket state. Backfill can prepend; only an explicit repair path may
 * replace a finalized candle.
 */
export function mergeRestCandles(
  state: CandleMergeState,
  incoming: readonly Candle[],
  options: RestMergeOptions,
): CandleMergeResult {
  const byTime = new Map(state.candles.map((candle) => [candle.time, candle]));
  const meta: Record<number, AcceptedCandleMeta> = { ...state.meta };
  const originalFirst = state.candles[0];
  let lastTime = state.candles.at(-1)?.time;
  let changed = false;
  let action: CandleMergeAction = 'none';
  const gaps: CandleGap[] = [];

  for (const candle of dedupeAndSort(incoming)) {
    const existingMeta = meta[candle.time];
    if (existingMeta) {
      const existing = byTime.get(candle.time)!;
      if (!options.allowFinalizedRepair || !existingMeta.finalized || sameCandle(existing, candle)) continue;
      byTime.set(candle.time, candle);
      meta[candle.time] = {
        lastEventTimeMs: options.receivedAtMs,
        lastEventIdentity: `rest-repair:${candle.time}:${options.receivedAtMs}`,
        finalized: true,
        source: 'rest',
      };
      changed = true;
      action = 'repair';
      continue;
    }

    const metadata: AcceptedCandleMeta = {
      lastEventTimeMs: options.receivedAtMs,
      lastEventIdentity: `rest:${candle.time}:${options.receivedAtMs}`,
      finalized: false,
      source: 'rest',
    };
    if (!originalFirst || candle.time < originalFirst.time) {
      byTime.set(candle.time, candle);
      meta[candle.time] = metadata;
      changed = true;
      if (action === 'none') action = 'prepend';
      continue;
    }
    if (lastTime != null && candle.time > lastTime) {
      const interval = INTERVAL_SECONDS[state.timeframe];
      const difference = candle.time - lastTime;
      if (difference > interval) {
        gaps.push({
          fromOpenTime: lastTime,
          toOpenTime: candle.time,
          missingIntervals: Math.max(1, Math.floor(difference / interval) - 1),
        });
      }
      byTime.set(candle.time, candle);
      meta[candle.time] = metadata;
      lastTime = candle.time;
      changed = true;
      if (action !== 'repair') action = 'append';
      continue;
    }
    // Filling an already-detected hole is a structural correction. Routine
    // polling is never permitted to perform this mutation.
    if (options.allowFinalizedRepair && originalFirst && lastTime != null
      && candle.time > originalFirst.time && candle.time < lastTime) {
      byTime.set(candle.time, candle);
      meta[candle.time] = { ...metadata, finalized: true, source: 'rest' };
      changed = true;
      action = 'repair';
    }
  }

  if (!changed) {
    return { state, accepted: false, action: 'none', reason: 'rest_not_authorized', gap: null };
  }
  const candles = [...byTime.values()].sort((left, right) => left.time - right.time);
  const next: CandleMergeState = {
    ...state,
    candles,
    meta,
    gaps: gaps.length > 0 ? [...state.gaps, ...gaps] : state.gaps,
  };
  return {
    state: next,
    accepted: true,
    action,
    candle: candles.at(-1),
    gap: gaps.at(-1) ?? null,
  };
}
