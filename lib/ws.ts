import { TIMEFRAMES, type Candle, type Timeframe } from './types';
import {
  BinanceStreamEnvelopeSchema,
  BookTickerEnvelopeSchema,
  AggTradeEnvelopeSchema,
  BinanceTickerMessageSchema,
} from './schemas';
import { createWebSocketSupervisor, type WebSocketSupervisor } from './marketData/wsSupervisor';

export interface KlineEventMeta {
  symbol: string;
  connectionEpoch: number;
  serverEventMs: number;
  closed: boolean;
}

type Listener = (bar: Candle, tf: Timeframe, meta: KlineEventMeta) => void;
type StatusListener = (status: WSStatus, epoch?: number) => void;
type HealthCheck = (epoch: number) => boolean;
export type BookTicker = { bid: number; bidQty: number; ask: number; askQty: number };
export interface BookTickerEventMeta {
  symbol: string;
  connectionEpoch: number;
  updateId: number;
}

export type Ticker24h = { price: number; change: number; changeAbs: number; volume: number };
export interface TickerEventMeta {
  symbol: string;
  connectionEpoch: number;
  serverEventMs: number;
}
export interface TradeEventMeta {
  symbol: string;
  connectionEpoch: number;
  serverEventMs: number;
}

/** A single aggregated taker trade from Binance @aggTrade. */
export type Trade = {
  id: number;
  price: number;
  qty: number;
  /** Aggressor side: 'buy' = taker bought (hit the ask), 'sell' = taker sold. */
  side: 'buy' | 'sell';
  /** Trade time, unix seconds. */
  time: number;
};

export type WSStatus = 'connecting' | 'open' | 'closed' | 'error';

const TF_TO_BINANCE: Record<Timeframe, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/**
 * Subscribe to Binance's combined kline stream for one symbol across
 * one or more timeframes. Returns a disposer. Calls `onBar` with the
 * *current* bar (not just closed bars) — the chart decides whether to
 * `update()` the last entry or push a new one.
 */
export function subscribeKlines(
  symbol: string,
  timeframes: Timeframe[],
  onBar: Listener,
  onStatus?: StatusListener,
  onHealthCheck?: HealthCheck,
): () => void {
  if (typeof window === 'undefined') return () => {};
  if (timeframes.length === 0) return () => {};
  const normalized = [...new Set(timeframes)].sort((a, b) => TIMEFRAMES.indexOf(a) - TIMEFRAMES.indexOf(b));
  const key = `${symbol.toLowerCase()}:${normalized.join(',')}`;
  let channel = klineChannels.get(key);
  if (!channel) {
    channel = createKlineChannel(symbol, normalized);
    klineChannels.set(key, channel);
  } else if (channel.linger) {
    clearTimeout(channel.linger);
    channel.linger = null;
  }

  channel.handlers.add(onBar);
  if (onStatus) {
    channel.statuses.add(onStatus);
    if (channel.lastStatus) onStatus(channel.lastStatus, channel.lastEpoch);
  }
  if (onHealthCheck) channel.healthChecks.add(onHealthCheck);
  return () => {
    channel.handlers.delete(onBar);
    if (onStatus) channel.statuses.delete(onStatus);
    if (onHealthCheck) channel.healthChecks.delete(onHealthCheck);
    if (channel.handlers.size !== 0 || channel.linger) return;
    // A zero-delay linger bridges StrictMode's synchronous cleanup/remount
    // without retaining a transport after the final subscriber has gone.
    channel.linger = setTimeout(() => {
      channel.linger = null;
      if (channel.handlers.size !== 0) return;
      klineChannels.delete(key);
      channel.supervisor.dispose();
      publishKlineStatus(channel, 'closed');
    }, 0);
  };
}

interface KlineChannel {
  handlers: Set<Listener>;
  statuses: Set<StatusListener>;
  healthChecks: Set<HealthCheck>;
  supervisor: WebSocketSupervisor;
  linger: ReturnType<typeof setTimeout> | null;
  lastStatus: WSStatus | null;
  lastEpoch: number;
}

const klineChannels = new Map<string, KlineChannel>();

function publishKlineStatus(channel: KlineChannel, status: WSStatus, epoch = channel.lastEpoch): void {
  channel.lastStatus = status;
  channel.lastEpoch = epoch;
  for (const listener of channel.statuses) listener(status, epoch);
}

function createKlineChannel(symbol: string, timeframes: Timeframe[]): KlineChannel {
  const sym = symbol.toLowerCase();
  const streams = timeframes.map((tf) => `${sym}@kline_${TF_TO_BINANCE[tf]}`).join('/');
  const streamToTf = new Map<string, Timeframe>(timeframes.map((tf) => [`${sym}@kline_${TF_TO_BINANCE[tf]}`, tf]));
  const channel = {
    handlers: new Set<Listener>(),
    statuses: new Set<StatusListener>(),
    healthChecks: new Set<HealthCheck>(),
    supervisor: null as unknown as WebSocketSupervisor,
    linger: null,
    lastStatus: null,
    lastEpoch: 0,
  } satisfies KlineChannel;
  channel.supervisor = createWebSocketSupervisor({
    url: `wss://stream.binance.com:9443/stream?streams=${streams}`,
    isHealthy: (epoch) => channel.healthChecks.size > 0 && [...channel.healthChecks].some((check) => check(epoch)),
    onState: (status, epoch) => publishKlineStatus(channel, status, epoch),
    onMessage: (evt, epoch) => {
      let json: unknown;
      try {
        json = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      const parsed = BinanceStreamEnvelopeSchema.safeParse(json);
      if (!parsed.success) {
        console.warn('Zod validation failed for subscribeKlines:', parsed.error);
        return;
      }
      const { stream, data } = parsed.data;
      if (!data || !stream) return;
      const tf = streamToTf.get(stream);
      if (!tf) return;
      const k = data.k;
      const bar: Candle = {
        time: Math.floor(k.t / 1000), open: Number(k.o), high: Number(k.h),
        low: Number(k.l), close: Number(k.c), volume: Number(k.v),
      };
      if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) return;
      const meta: KlineEventMeta = { symbol: data.s, connectionEpoch: epoch, serverEventMs: data.E, closed: k.x };
      for (const handler of channel.handlers) handler(bar, tf, meta);
    },
  });
  channel.supervisor.start();
  return channel;
}

// ---- Shared supervised auxiliary channels ----------------------------------
// Ticker, bookTicker and aggTrade now use the same epoch-owned supervisor as
// klines. Their data remains independent: only ticker participates in the
// execution-price gate, while book and trade tape are presentation feeds.

type TickerListener = (ticker: Ticker24h, meta: TickerEventMeta) => void;
type TradeListener = (trade: Trade, meta: TradeEventMeta) => void;
type BookTickerListener = (ticker: BookTicker, meta: BookTickerEventMeta) => void;

interface SharedChannel<L> {
  handlers: Set<L>;
  statuses: Set<StatusListener>;
  supervisor: WebSocketSupervisor;
  linger: ReturnType<typeof setTimeout> | null;
  lastStatus: WSStatus | null;
  lastEpoch: number;
}

function publishAuxStatus<L>(channel: SharedChannel<L>, status: WSStatus, epoch = channel.lastEpoch): void {
  channel.lastStatus = status;
  channel.lastEpoch = epoch;
  for (const listener of channel.statuses) listener(status, epoch);
}

function addSharedListener<L>(
  channels: Map<string, SharedChannel<L>>,
  key: string,
  create: () => SharedChannel<L>,
  listener: L,
  onStatus: StatusListener | undefined,
  lingerMs: number,
): () => void {
  let channel = channels.get(key);
  if (!channel) {
    channel = create();
    channels.set(key, channel);
  } else if (channel.linger) {
    clearTimeout(channel.linger);
    channel.linger = null;
  }
  channel.handlers.add(listener);
  if (onStatus) {
    channel.statuses.add(onStatus);
    if (channel.lastStatus) onStatus(channel.lastStatus, channel.lastEpoch);
  }
  return () => {
    channel.handlers.delete(listener);
    if (onStatus) channel.statuses.delete(onStatus);
    if (channel.handlers.size !== 0 || channel.linger) return;
    channel.linger = setTimeout(() => {
      channel!.linger = null;
      if (channel!.handlers.size !== 0) return;
      channels.delete(key);
      channel!.supervisor.dispose();
      // The final disposer has already unsubscribed; retain state for any
      // synchronous remount, but no late socket callback can escape dispose.
      channel!.lastStatus = 'closed';
    }, lingerMs);
  };
}

const tickerChannels = new Map<string, SharedChannel<TickerListener>>();

/** Supervised Binance 24-hour ticker. A valid ticker payload, not transport
 * open, is what lets callers mark the execution-price feed fresh. */
export function subscribeTicker(
  symbol: string,
  onTicker: TickerListener,
  onStatus?: StatusListener,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const key = symbol.toLowerCase();
  return addSharedListener(tickerChannels, key, () => createTickerChannel(symbol), onTicker, onStatus, 0);
}

function createTickerChannel(symbol: string): SharedChannel<TickerListener> {
  const sym = symbol.toUpperCase();
  let healthyEpoch = 0;
  const channel = {
    handlers: new Set<TickerListener>(), statuses: new Set<StatusListener>(),
    supervisor: null as unknown as WebSocketSupervisor, linger: null,
    lastStatus: null, lastEpoch: 0,
  } satisfies SharedChannel<TickerListener>;
  channel.supervisor = createWebSocketSupervisor({
    url: `wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@ticker`,
    isHealthy: (epoch) => healthyEpoch === epoch,
    onState: (status, epoch) => publishAuxStatus(channel, status, epoch),
    onMessage: (event, epoch) => {
      let json: unknown;
      try { json = JSON.parse(event.data as string); } catch { return; }
      const parsed = BinanceTickerMessageSchema.safeParse(json);
      if (!parsed.success || parsed.data.s.toUpperCase() !== sym) return;
      const price = Number(parsed.data.c);
      const change = Number(parsed.data.P);
      const changeAbs = Number(parsed.data.p);
      const volume = Number(parsed.data.v);
      if (![price, change, changeAbs, volume].every(Number.isFinite)) return;
      healthyEpoch = epoch;
      const meta: TickerEventMeta = { symbol: parsed.data.s, connectionEpoch: epoch, serverEventMs: parsed.data.E };
      for (const listener of channel.handlers) listener({ price, change, changeAbs, volume }, meta);
    },
  });
  channel.supervisor.start();
  return channel;
}

const tradeChannels = new Map<string, SharedChannel<TradeListener>>();

/** Shared, epoch-safe @aggTrade transport. It is deliberately optional: tape
 * failures do not participate in MarketDataIntegrity or live execution trust. */
export function subscribeTrades(
  symbol: string,
  onTrade: TradeListener,
  onStatus?: StatusListener,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const key = symbol.toLowerCase();
  return addSharedListener(tradeChannels, key, () => createTradeChannel(symbol), onTrade, onStatus, 0);
}

function createTradeChannel(symbol: string): SharedChannel<TradeListener> {
  const sym = symbol.toUpperCase();
  let lastTradeId: number | null = null;
  let orderingEpoch = 0;
  let healthyEpoch = 0;
  const channel = {
    handlers: new Set<TradeListener>(), statuses: new Set<StatusListener>(),
    supervisor: null as unknown as WebSocketSupervisor, linger: null,
    lastStatus: null, lastEpoch: 0,
  } satisfies SharedChannel<TradeListener>;
  channel.supervisor = createWebSocketSupervisor({
    url: `wss://stream.binance.com:9443/stream?streams=${sym.toLowerCase()}@aggTrade`,
    isHealthy: (epoch) => healthyEpoch === epoch,
    onState: (status, epoch) => {
      if (epoch !== orderingEpoch) { orderingEpoch = epoch; lastTradeId = null; }
      publishAuxStatus(channel, status, epoch);
    },
    onMessage: (event, epoch) => {
      let json: unknown;
      try { json = JSON.parse(event.data as string); } catch { return; }
      const parsed = AggTradeEnvelopeSchema.safeParse(json);
      const data = parsed.success ? parsed.data.data : undefined;
      if (!data || data.s.toUpperCase() !== sym || (lastTradeId != null && data.a <= lastTradeId)) return;
      const price = Number(data.p);
      const qty = Number(data.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
      lastTradeId = data.a;
      healthyEpoch = epoch;
      const trade: Trade = { id: data.a, price, qty, side: data.m ? 'sell' : 'buy', time: Math.floor(data.T / 1000) };
      const meta: TradeEventMeta = { symbol: data.s, connectionEpoch: epoch, serverEventMs: data.E };
      for (const listener of channel.handlers) listener(trade, meta);
    },
  });
  channel.supervisor.start();
  return channel;
}

// ---- Shared bookTicker channels -------------------------------------------
// This retains the existing five-second StrictMode linger while making socket
// attempts, retry timers and stale callbacks supervisor-owned.
const BT_LINGER_MS = 5000;
const btChannels = new Map<string, SharedChannel<BookTickerListener>>();

/** Subscribe to Binance's @bookTicker stream for real-time best bid/ask. */
export function subscribeBookTicker(
  symbol: string,
  onTick: BookTickerListener,
  onStatus?: StatusListener,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const key = symbol.toLowerCase();
  return addSharedListener(btChannels, key, () => createBookTickerChannel(symbol), onTick, onStatus, BT_LINGER_MS);
}

function createBookTickerChannel(symbol: string): SharedChannel<BookTickerListener> {
  const sym = symbol.toUpperCase();
  let lastUpdateId: number | null = null;
  let orderingEpoch = 0;
  let healthyEpoch = 0;
  const channel = {
    handlers: new Set<BookTickerListener>(), statuses: new Set<StatusListener>(),
    supervisor: null as unknown as WebSocketSupervisor, linger: null,
    lastStatus: null, lastEpoch: 0,
  } satisfies SharedChannel<BookTickerListener>;
  channel.supervisor = createWebSocketSupervisor({
    url: `wss://stream.binance.com:9443/stream?streams=${sym.toLowerCase()}@bookTicker`,
    isHealthy: (epoch) => healthyEpoch === epoch,
    onState: (status, epoch) => {
      if (epoch !== orderingEpoch) { orderingEpoch = epoch; lastUpdateId = null; }
      publishAuxStatus(channel, status, epoch);
    },
    onMessage: (event, epoch) => {
      let json: unknown;
      try { json = JSON.parse(event.data as string); } catch { return; }
      const parsed = BookTickerEnvelopeSchema.safeParse(json);
      const data = parsed.success ? parsed.data.data : undefined;
      if (!data || data.s.toUpperCase() !== sym || (lastUpdateId != null && data.u <= lastUpdateId)) return;
      const bid = Number(data.b);
      const bidQty = Number(data.B);
      const ask = Number(data.a);
      const askQty = Number(data.A);
      if (![bid, bidQty, ask, askQty].every(Number.isFinite)) return;
      lastUpdateId = data.u;
      healthyEpoch = epoch;
      const ticker: BookTicker = { bid, bidQty, ask, askQty };
      const meta: BookTickerEventMeta = { symbol: data.s, connectionEpoch: epoch, updateId: data.u };
      for (const listener of channel.handlers) listener(ticker, meta);
    },
  });
  channel.supervisor.start();
  return channel;
}



/** Request a fresh epoch for all active transports of one market-data session.
 * This is used after sleep/wake or a silent-feed diagnosis; it never claims
 * health itself, so feed health still requires valid synchronized messages. */
function forEachMarketDataSupervisor(symbol: string, visit: (supervisor: WebSocketSupervisor) => void): number {
  const key = symbol.toLowerCase();
  let count = 0;
  for (const [channelKey, channel] of klineChannels) {
    if (!channelKey.startsWith(`${key}:`)) continue;
    visit(channel.supervisor);
    count += 1;
  }
  for (const channels of [tickerChannels, btChannels, tradeChannels] as const) {
    const channel = channels.get(key);
    if (!channel) continue;
    visit(channel.supervisor);
    count += 1;
  }
  return count;
}

/** Stop reconnect attempts while the browser is offline. */
export function suspendMarketDataTransports(symbol: string): number {
  return forEachMarketDataSupervisor(symbol, (supervisor) => supervisor.suspend());
}

/** Request a fresh epoch for all active transports of one market-data session.
 * This is used after sleep/wake or a silent-feed diagnosis; it never claims
 * health itself, so feed health still requires valid synchronized messages. */
export function recoverMarketDataTransports(symbol: string): number {
  return forEachMarketDataSupervisor(symbol, (supervisor) => {
    if (!supervisor.resume()) supervisor.restart();
  });
}
