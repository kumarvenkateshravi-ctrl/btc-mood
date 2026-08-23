// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeBookTicker } from './ws';

// Minimal WebSocket stub tracking constructions and closes.
class FakeWS {
  static instances: FakeWS[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send() {}
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

describe('shared bookTicker channel', () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('remount within the linger window reuses the live socket (no close, no reopen)', () => {
    const d1 = subscribeBookTicker('REMOUNTUSDT', () => {});
    expect(FakeWS.instances.length).toBe(1);
    d1(); // unmount (StrictMode / HMR)
    const d2 = subscribeBookTicker('REMOUNTUSDT', () => {}); // remount 1ms later
    expect(FakeWS.instances.length).toBe(1); // SAME socket, not a new one
    expect(FakeWS.instances[0].closed).toBe(false);
    d2();
    vi.advanceTimersByTime(6000); // linger expires with no subscribers
    expect(FakeWS.instances[0].closed).toBe(true);
  });

  it('two concurrent subscribers share one socket; both receive ticks', () => {
    const ticks1: number[] = [];
    const ticks2: number[] = [];
    const d1 = subscribeBookTicker('SHAREUSDT', (t) => ticks1.push(t.bid));
    const d2 = subscribeBookTicker('SHAREUSDT', (t) => ticks2.push(t.bid));
    expect(FakeWS.instances.length).toBe(1);
    const ws = FakeWS.instances[0];
    ws.onmessage?.({
      data: JSON.stringify({ stream: 'shareusdt@bookTicker', data: { u: 1, s: 'SHAREUSDT', b: '100.5', B: '1', a: '100.6', A: '2' } }),
    });
    expect(ticks1).toEqual([100.5]);
    expect(ticks2).toEqual([100.5]);
    d1();
    // remaining subscriber keeps the socket alive past the linger
    vi.advanceTimersByTime(10000);
    expect(ws.closed).toBe(false);
    d2();
    vi.advanceTimersByTime(6000);
    expect(ws.closed).toBe(true);
  });

  it('different symbols get their own sockets', () => {
    const d1 = subscribeBookTicker('AAAUSDT', () => {});
    const d2 = subscribeBookTicker('BBBUSDT', () => {});
    expect(FakeWS.instances.length).toBe(2);
    d1(); d2();
    vi.advanceTimersByTime(6000);
  });

  it('rejects lower/equal update ids and establishes a new baseline after reconnect', () => {
    const ids: number[] = [];
    const dispose = subscribeBookTicker('ORDERUSDT', (t) => ids.push(t.bid));
    const first = FakeWS.instances[0];
    first.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 7, s: 'OTHERUSDT', b: '200', B: '1', a: '201', A: '1' } }) });
    first.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 7, s: 'ORDERUSDT', b: '100', B: '1', a: '101', A: '1' } }) });
    first.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 7, s: 'ORDERUSDT', b: '99', B: '1', a: '100', A: '1' } }) });
    first.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 6, s: 'ORDERUSDT', b: '98', B: '1', a: '99', A: '1' } }) });
    expect(ids).toEqual([100]);

    first.onclose?.();
    vi.advanceTimersByTime(30_000);
    const second = FakeWS.instances[1];
    first.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 8, s: 'ORDERUSDT', b: '200', B: '1', a: '201', A: '1' } }) });
    second.onmessage?.({ data: JSON.stringify({ stream: 'orderusdt@bookTicker', data: { u: 1, s: 'ORDERUSDT', b: '102', B: '1', a: '103', A: '1' } }) });
    expect(ids).toEqual([100, 102]);
    dispose();
    vi.advanceTimersByTime(6000);
  });
});
