// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverMarketDataTransports, subscribeTicker, subscribeTrades, suspendMarketDataTransports } from './ws';

class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) { FakeWS.instances.push(this); }
  send() {}
  close() { this.closed = true; this.onclose?.(); }
}

const tickerPayload = (symbol = 'BTCUSDT', eventTime = 1_000) => JSON.stringify({
  e: '24hrTicker', E: eventTime, s: symbol, c: '100', P: '2', p: '2', v: '3',
});
const tradePayload = (symbol = 'BTCUSDT', id = 1, eventTime = 1_000) => JSON.stringify({
  stream: `${symbol.toLowerCase()}@aggTrade`,
  data: { e: 'aggTrade', E: eventTime, s: symbol, a: id, p: '100', q: '0.5', T: eventTime, m: false },
});

describe('supervised auxiliary transports', () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ticker accepts only current-epoch, current-symbol events and stops delivery after disposal', () => {
    const ticks: number[] = [];
    const dispose = subscribeTicker('BTCUSDT', (ticker) => ticks.push(ticker.price));
    const first = FakeWS.instances[0];
    first.onopen?.();
    first.onmessage?.({ data: tickerPayload('ETHUSDT') });
    expect(ticks).toEqual([]);
    first.onmessage?.({ data: tickerPayload() });
    expect(ticks).toEqual([100]);

    first.onclose?.();
    vi.advanceTimersByTime(30_000);
    const second = FakeWS.instances[1];
    second.onopen?.();
    first.onmessage?.({ data: tickerPayload() });
    expect(ticks).toEqual([100]);
    dispose();
    second.onmessage?.({ data: tickerPayload() });
    expect(ticks).toEqual([100]);
  });

  it('suspends ticker reconnect work offline and resumes it through one recovery epoch', () => {
    const ticks: number[] = [];
    const dispose = subscribeTicker('BTCUSDT', (ticker) => ticks.push(ticker.price));
    const first = FakeWS.instances[0];
    suspendMarketDataTransports('BTCUSDT');
    vi.advanceTimersByTime(30_000);
    expect(FakeWS.instances).toHaveLength(1);
    recoverMarketDataTransports('BTCUSDT');
    expect(FakeWS.instances).toHaveLength(2);
    first.onmessage?.({ data: tickerPayload() });
    expect(ticks).toEqual([]);
    dispose();
  });

  it('shares one same-symbol aggTrade transport and closes it after the final disposal', () => {
    const first: number[] = [];
    const second: number[] = [];
    const disposeFirst = subscribeTrades('BTCUSDT', (trade) => first.push(trade.id));
    const disposeSecond = subscribeTrades('BTCUSDT', (trade) => second.push(trade.id));
    expect(FakeWS.instances).toHaveLength(1);
    const socket = FakeWS.instances[0];
    socket.onmessage?.({ data: tradePayload() });
    expect(first).toEqual([1]);
    expect(second).toEqual([1]);
    disposeFirst();
    expect(socket.closed).toBe(false);
    disposeSecond();
    vi.runOnlyPendingTimers();
    expect(socket.closed).toBe(true);
  });
});
