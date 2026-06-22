import type { Candle, Timeframe } from './types';
import {
  BinanceStreamEnvelopeSchema,
  BookTickerEnvelopeSchema,
  AggTradeEnvelopeSchema,
} from './schemas';

type Listener = (bar: Candle, tf: Timeframe) => void;
type StatusListener = (status: WSStatus) => void;
export type BookTicker = { bid: number; bidQty: number; ask: number; askQty: number };

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
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
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
): () => void {
  if (typeof window === 'undefined') return () => {};
  if (timeframes.length === 0) return () => {};

  const sym = symbol.toLowerCase();
  const streams = timeframes
    .map((tf) => `${sym}@kline_${TF_TO_BINANCE[tf]}`)
    .join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const setStatus = (s: WSStatus) => onStatus?.(s);

  // Build stream-name → TF lookup so we can dispatch each frame to the
  // right TF without inferring from bar timestamps.
  const streamToTf = new Map<string, Timeframe>();
  for (const tf of timeframes) {
    streamToTf.set(`${sym}@kline_${TF_TO_BINANCE[tf]}`, tf);
  }

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      setStatus('open');
    };

    ws.onmessage = (evt) => {
      let json: unknown;
      try {
        json = JSON.parse(evt.data as string);
      } catch {
        return; // Non-JSON frame (e.g. a keep-alive echo) — ignore.
      }
      // Validate the combined-stream envelope with the shared schema so
      // a malformed frame is dropped instead of producing NaN candles.
      const parsed = BinanceStreamEnvelopeSchema.safeParse(json);
      if (!parsed.success) return;
      const { stream, data } = parsed.data;
      if (!data || !stream) return;
      const tf = streamToTf.get(stream);
      if (!tf) return;
      const k = data.k;
      const bar: Candle = {
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
      };
      // Binance sends numbers as strings; guard against a non-numeric
      // field slipping through as NaN and corrupting the chart.
      if (
        ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(
          Number.isFinite,
        )
      ) {
        return;
      }
      onBar(bar, tf);
    };

    ws.onerror = () => {
      setStatus('error');
    };

    ws.onclose = () => {
      setStatus('closed');
      ws = null;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2500);
  };

  connect();

  // Light keep-alive: many browsers/proxies drop idle sockets. Binance
  // ignores client pings, but sending a frame keeps the TCP path warm.
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send('ping');
      } catch {
        // noop
      }
    }
  }, 30000);

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        // noop
      }
      ws = null;
    }
    setStatus('closed');
  };
}

/**
 * Subscribe to Binance's @aggTrade stream — the live tape of aggressor
 * trades for one symbol. Returns a disposer. `onTrade` fires once per
 * aggregated trade; consumers should batch their own rendering since
 * BTC can produce dozens of trades per second.
 */
export function subscribeTrades(
  symbol: string,
  onTrade: (trade: Trade) => void,
  onStatus?: StatusListener,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const sym = symbol.toLowerCase();
  const stream = `${sym}@aggTrade`;
  const url = `wss://stream.binance.com:9443/stream?streams=${stream}`;

  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const setStatus = (s: WSStatus) => onStatus?.(s);

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => setStatus('open');

    ws.onmessage = (evt) => {
      let json: unknown;
      try { json = JSON.parse(evt.data as string); } catch { return; }
      const parsed = AggTradeEnvelopeSchema.safeParse(json);
      if (!parsed.success) return;
      const { data } = parsed.data;
      if (!data) return;
      const price = Number(data.p);
      const qty = Number(data.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
      onTrade({
        id: data.a,
        price,
        qty,
        side: data.m ? 'sell' : 'buy',
        time: Math.floor(data.T / 1000),
      });
    };

    ws.onerror = () => setStatus('error');

    ws.onclose = () => {
      setStatus('closed');
      ws = null;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2500);
  };

  connect();

  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send('ping'); } catch {}
    }
  }, 30000);

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    setStatus('closed');
  };
}

/**
 * Subscribe to Binance's @bookTicker stream for real-time best bid/ask.
 * Returns a disposer. Updates are pushed on every order book change.
 */
export function subscribeBookTicker(
  symbol: string,
  onTick: (ticker: BookTicker) => void,
  onStatus?: StatusListener,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const sym = symbol.toLowerCase();
  const stream = `${sym}@bookTicker`;
  const url = `wss://stream.binance.com:9443/stream?streams=${stream}`;

  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const setStatus = (s: WSStatus) => onStatus?.(s);

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => setStatus('open');

    ws.onmessage = (evt) => {
      let json: unknown;
      try { json = JSON.parse(evt.data as string); } catch { return; }
      const parsed = BookTickerEnvelopeSchema.safeParse(json);
      if (!parsed.success) return;
      const { data } = parsed.data;
      if (!data) return;
      const bid = Number(data.b);
      const ask = Number(data.a);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
      onTick({
        bid,
        bidQty: Number(data.B),
        ask,
        askQty: Number(data.A),
      });
    };

    ws.onerror = () => setStatus('error');

    ws.onclose = () => {
      setStatus('closed');
      ws = null;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2500);
  };

  connect();

  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send('ping'); } catch {}
    }
  }, 30000);

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    setStatus('closed');
  };
}
