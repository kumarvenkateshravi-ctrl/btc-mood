import { TIMEFRAMES, type Timeframe } from '../types';
import type { WSStatus } from '../ws';

export type FeedKind = 'kline' | 'ticker' | 'bookTicker';
export type FeedSynchronization = 'unsynchronized' | 'synchronizing' | 'synchronized';
export type FeedHealthState =
  | 'connecting'
  | 'synchronizing'
  | 'live'
  | 'degraded'
  | 'stale'
  | 'reconnecting'
  | 'unavailable';

export interface FeedHealth {
  key: string;
  symbol: string;
  kind: FeedKind;
  timeframe?: Timeframe;
  connectionEpoch: number;
  transport: WSStatus;
  synchronization: FeedSynchronization;
  lastValidMessageMs: number;
  lastServerEventMs: number;
  lastConfirmedClosedCandleTime: number | null;
  reconnectCount: number;
  stale: boolean;
  state: FeedHealthState;
}

export interface FeedHealthSnapshot {
  symbol: string;
  requiredKlineTimeframes: readonly Timeframe[];
  feeds: Readonly<Record<string, FeedHealth>>;
}

export interface FeedTransportUpdate {
  kind: FeedKind;
  timeframe?: Timeframe;
  transport: WSStatus;
  epoch: number;
  nowMs: number;
}

export interface FeedMessageUpdate {
  kind: FeedKind;
  timeframe?: Timeframe;
  epoch: number;
  nowMs: number;
  serverEventMs?: number;
  confirmedClosedCandleTime?: number;
}

export interface FeedRepairUpdate {
  kind: FeedKind;
  timeframe?: Timeframe;
  epoch: number;
  nowMs: number;
}

export interface FeedHealthSummary {
  allRequiredKlinesLive: boolean;
  anyRequiredKlineStale: boolean;
  anyRequiredKlineSynchronizing: boolean;
  anyRequiredKlineUnavailable: boolean;
  tickerLive: boolean;
  hasLiveSynchronizationAttempt: boolean;
}

const DEFAULT_STALE_AFTER_MS = 15_000;

export function feedKey(kind: FeedKind, timeframe?: Timeframe): string {
  return kind === 'kline' ? `kline:${timeframe}` : kind;
}

function createFeed(symbol: string, kind: FeedKind, timeframe?: Timeframe): FeedHealth {
  return {
    key: feedKey(kind, timeframe),
    symbol,
    kind,
    timeframe,
    connectionEpoch: 0,
    transport: 'closed',
    synchronization: 'unsynchronized',
    lastValidMessageMs: 0,
    lastServerEventMs: 0,
    lastConfirmedClosedCandleTime: null,
    reconnectCount: 0,
    stale: false,
    state: 'unavailable',
  };
}

export function createFeedHealthSnapshot(
  symbol: string,
  requiredKlineTimeframes: readonly Timeframe[] = TIMEFRAMES,
): FeedHealthSnapshot {
  const feeds: Record<string, FeedHealth> = {};
  for (const timeframe of requiredKlineTimeframes) {
    const feed = createFeed(symbol, 'kline', timeframe);
    feeds[feed.key] = feed;
  }
  for (const kind of ['ticker', 'bookTicker'] as const) {
    const feed = createFeed(symbol, kind);
    feeds[feed.key] = feed;
  }
  return { symbol, requiredKlineTimeframes: [...requiredKlineTimeframes], feeds };
}

function cloneWith(snapshot: FeedHealthSnapshot, key: string, feed: FeedHealth): FeedHealthSnapshot {
  return { ...snapshot, feeds: { ...snapshot.feeds, [key]: feed } };
}

function stateFor(feed: FeedHealth, nowMs: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): FeedHealth {
  const stale = feed.lastValidMessageMs > 0 && nowMs - feed.lastValidMessageMs > staleAfterMs;
  let state: FeedHealthState;
  if (feed.transport === 'connecting') state = feed.connectionEpoch > 1 ? 'reconnecting' : 'connecting';
  else if (feed.transport === 'error') state = feed.lastValidMessageMs > 0 ? 'degraded' : 'unavailable';
  else if (feed.transport === 'closed') state = feed.connectionEpoch > 0 ? 'reconnecting' : 'unavailable';
  else if (feed.synchronization !== 'synchronized') state = 'synchronizing';
  else if (stale) state = 'stale';
  else state = 'live';
  return stale === feed.stale && state === feed.state ? feed : { ...feed, stale, state };
}

/** Updates a transport event only when it belongs to the current/new epoch. */
export function markFeedTransport(snapshot: FeedHealthSnapshot, update: FeedTransportUpdate): FeedHealthSnapshot {
  const key = feedKey(update.kind, update.timeframe);
  const existing = snapshot.feeds[key];
  if (!existing || update.epoch < existing.connectionEpoch) return snapshot;
  const epochChanged = update.epoch > existing.connectionEpoch;
  const feed = stateFor({
    ...existing,
    connectionEpoch: update.epoch,
    transport: update.transport,
    lastValidMessageMs: epochChanged ? 0 : existing.lastValidMessageMs,
    lastServerEventMs: epochChanged ? 0 : existing.lastServerEventMs,
    synchronization: epochChanged || update.transport !== 'open'
      ? (update.transport === 'open' ? 'synchronizing' : 'unsynchronized')
      : existing.synchronization,
    reconnectCount: epochChanged && existing.connectionEpoch > 0
      ? existing.reconnectCount + 1
      : existing.reconnectCount,
  }, update.nowMs);
  return cloneWith(snapshot, key, feed);
}

/** Records only validated messages from the active connection epoch. */
export function markFeedMessage(snapshot: FeedHealthSnapshot, update: FeedMessageUpdate): FeedHealthSnapshot {
  const key = feedKey(update.kind, update.timeframe);
  const existing = snapshot.feeds[key];
  if (!existing || update.epoch !== existing.connectionEpoch || existing.transport !== 'open') return snapshot;
  const feed = stateFor({
    ...existing,
    synchronization: 'synchronized',
    lastValidMessageMs: Math.max(existing.lastValidMessageMs, update.nowMs),
    lastServerEventMs: Math.max(existing.lastServerEventMs, update.serverEventMs ?? 0),
    lastConfirmedClosedCandleTime: update.confirmedClosedCandleTime == null
      ? existing.lastConfirmedClosedCandleTime
      : Math.max(existing.lastConfirmedClosedCandleTime ?? 0, update.confirmedClosedCandleTime),
  }, update.nowMs);
  return cloneWith(snapshot, key, feed);
}


/** A detected candle discontinuity keeps this stream non-live during REST repair. */
export function markFeedSynchronizing(snapshot: FeedHealthSnapshot, update: FeedRepairUpdate): FeedHealthSnapshot {
  const key = feedKey(update.kind, update.timeframe);
  const existing = snapshot.feeds[key];
  if (!existing || update.epoch !== existing.connectionEpoch) return snapshot;
  const feed = stateFor({ ...existing, synchronization: 'synchronizing' }, update.nowMs);
  return cloneWith(snapshot, key, feed);
}

/** Only validated repair completion may restore a synchronizing stream. */
export function markFeedRepaired(snapshot: FeedHealthSnapshot, update: FeedRepairUpdate): FeedHealthSnapshot {
  const key = feedKey(update.kind, update.timeframe);
  const existing = snapshot.feeds[key];
  if (!existing || update.epoch !== existing.connectionEpoch) return snapshot;
  const feed = stateFor({
    ...existing,
    synchronization: 'synchronized',
    lastValidMessageMs: Math.max(existing.lastValidMessageMs, update.nowMs),
  }, update.nowMs);
  return cloneWith(snapshot, key, feed);
}

/** Re-evaluates stale state without allowing unrelated feeds to refresh it. */
export function refreshFeedHealth(snapshot: FeedHealthSnapshot, nowMs: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): FeedHealthSnapshot {
  let feeds: Record<string, FeedHealth> | null = null;
  for (const [key, feed] of Object.entries(snapshot.feeds)) {
    const next = stateFor(feed, nowMs, staleAfterMs);
    if (next === feed) continue;
    if (!feeds) feeds = { ...snapshot.feeds };
    feeds[key] = next;
  }
  return feeds ? { ...snapshot, feeds } : snapshot;
}

export function summarizeFeedHealth(snapshot: FeedHealthSnapshot, nowMs: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): FeedHealthSummary {
  const refreshed = refreshFeedHealth(snapshot, nowMs, staleAfterMs);
  const required = refreshed.requiredKlineTimeframes.map((timeframe) => refreshed.feeds[feedKey('kline', timeframe)]);
  const ticker = refreshed.feeds[feedKey('ticker')];
  return {
    allRequiredKlinesLive: required.length > 0 && required.every((feed) => feed?.state === 'live'),
    anyRequiredKlineStale: required.some((feed) => feed?.state === 'stale' || feed?.state === 'degraded'),
    anyRequiredKlineSynchronizing: required.some((feed) => feed?.state === 'connecting' || feed?.state === 'reconnecting' || feed?.state === 'synchronizing'),
    anyRequiredKlineUnavailable: required.some((feed) => !feed || feed.state === 'unavailable'),
    tickerLive: ticker?.state === 'live',
    hasLiveSynchronizationAttempt: required.some((feed) => (feed?.connectionEpoch ?? 0) > 0),
  };
}
