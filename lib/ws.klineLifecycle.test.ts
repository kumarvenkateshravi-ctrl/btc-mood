// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeKlines } from './ws';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  emitOpen() { this.readyState = 1; this.onopen?.(); }
  emitMessage(data: string) { this.onmessage?.({ data }); }
  emitClose() { this.readyState = 3; this.onclose?.(); }
}

function kline(symbol: string, tf = '5m', time = 1_700_000_000) {
  return JSON.stringify({
    stream: `${symbol.toLowerCase()}@kline_${tf}`,
    data: {
      e: 'kline', E: time * 1000, s: symbol,
      k: { t: time * 1000, T: time * 1000 + 299_999, s: symbol, i: tf, o: '100', c: '101', h: '102', l: '99', v: '4', x: false },
    },
  });
}

describe('supervised kline subscription lifecycle', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is StrictMode-safe: an immediate remount reuses the one kline transport', () => {
    const first = subscribeKlines('BTCUSDT', ['5m'], () => {});
    const socket = FakeWebSocket.instances[0];
    first();
    const bars: number[] = [];
    const second = subscribeKlines('BTCUSDT', ['5m'], (bar) => bars.push(bar.time));

    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.emitMessage(kline('BTCUSDT'));
    expect(bars).toEqual([1_700_000_000]);
    second();
    vi.runOnlyPendingTimers();
    expect(socket.closed).toBe(true);
  });

  it('invalidates a previous symbol subscription and rejects its late messages', () => {
    const oldBars: number[] = [];
    const oldDispose = subscribeKlines('BTCUSDT', ['5m'], (bar) => oldBars.push(bar.time));
    const oldSocket = FakeWebSocket.instances[0];
    oldDispose();
    const newBars: number[] = [];
    const nextDispose = subscribeKlines('ETHUSDT', ['5m'], (bar) => newBars.push(bar.time));
    const newSocket = FakeWebSocket.instances[1];

    oldSocket.emitMessage(kline('BTCUSDT'));
    newSocket.emitMessage(kline('ETHUSDT'));
    expect(oldBars).toEqual([]);
    expect(newBars).toEqual([1_700_000_000]);
    vi.runOnlyPendingTimers();
    expect(oldSocket.closed).toBe(true);
    nextDispose();
  });

  it('does not deliver messages after final disposal, including after a scheduled reconnect', () => {
    const bars: number[] = [];
    const dispose = subscribeKlines('BTCUSDT', ['5m'], (bar) => bars.push(bar.time));
    const socket = FakeWebSocket.instances[0];
    socket.emitClose();
    dispose();
    vi.runOnlyPendingTimers();
    socket.emitMessage(kline('BTCUSDT'));

    expect(bars).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
