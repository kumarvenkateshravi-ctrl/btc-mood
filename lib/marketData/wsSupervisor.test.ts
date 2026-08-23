// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketSupervisor } from './wsSupervisor';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  emitOpen() { this.readyState = 1; this.onopen?.(); }
  emitMessage(data = 'message') { this.onmessage?.({ data }); }
  emitError() { this.onerror?.(); }
  emitClose() { this.readyState = 3; this.onclose?.(); }
}

describe('WebSocket supervisor lifecycle ownership', () => {
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

  it('disposal while connected prevents future delivery and invalidates callbacks', () => {
    const messages: string[] = [];
    const states: string[] = [];
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/one',
      onMessage: (event) => messages.push(event.data),
      onState: (state) => states.push(state),
    });
    supervisor.start();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    supervisor.dispose();
    socket.emitMessage('late');
    socket.emitError();
    socket.emitClose();

    expect(messages).toEqual([]);
    expect(states).toEqual(['connecting', 'open']);
    expect(socket.closed).toBe(true);
    expect(supervisor.diagnostics().disposed).toBe(true);
  });

  it('disposal while connecting cancels the attempt and prevents future delivery', () => {
    const opened = vi.fn();
    const supervisor = createWebSocketSupervisor({ url: 'wss://example.test/two', onOpen: opened });
    supervisor.start();
    const socket = FakeWebSocket.instances[0];
    supervisor.dispose();
    socket.emitOpen();

    expect(opened).not.toHaveBeenCalled();
    expect(socket.closed).toBe(true);
  });

  it('cancels a pending reconnect when disposed', () => {
    const supervisor = createWebSocketSupervisor({ url: 'wss://example.test/three', reconnectDelayMs: 2500 });
    supervisor.start();
    FakeWebSocket.instances[0].emitClose();
    expect(supervisor.diagnostics().reconnectPending).toBe(true);
    supervisor.dispose();
    vi.advanceTimersByTime(5000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(supervisor.diagnostics().reconnectPending).toBe(false);
  });

  it('ignores old-epoch messages, open, close, and error after reconnect', () => {
    const messages: string[] = [];
    const states: string[] = [];
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/four',
      reconnectDelayMs: 10,
      onMessage: (event) => messages.push(event.data),
      onState: (state) => states.push(state),
    });
    supervisor.start();
    const oldSocket = FakeWebSocket.instances[0];
    oldSocket.emitClose();
    vi.advanceTimersByTime(10);
    const currentSocket = FakeWebSocket.instances[1];
    currentSocket.emitOpen();
    const stateCount = states.length;

    oldSocket.emitMessage('old');
    oldSocket.emitOpen();
    oldSocket.emitError();
    oldSocket.emitClose();

    expect(messages).toEqual([]);
    expect(states).toHaveLength(stateCount);
    expect(supervisor.diagnostics().epoch).toBe(2);
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    supervisor.dispose();
  });

  it('owns exactly one reconnect timer and never overlaps reconnect sockets', () => {
    const supervisor = createWebSocketSupervisor({ url: 'wss://example.test/five', reconnectDelayMs: 25 });
    supervisor.start();
    const socket = FakeWebSocket.instances[0];
    socket.emitClose();
    socket.emitClose();
    expect(supervisor.diagnostics().reconnectPending).toBe(true);
    vi.advanceTimersByTime(25);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(supervisor.diagnostics().reconnectPending).toBe(false);
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    supervisor.dispose();
  });

  it('uses a bounded exponential delay with deterministic jitter', () => {
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/backoff', reconnectBaseDelayMs: 500,
      reconnectMaxDelayMs: 30_000, reconnectJitterRatio: 0.2, random: () => 0.5,
    });
    supervisor.start();
    FakeWebSocket.instances[0].emitClose();
    expect(supervisor.diagnostics().retryAttempt).toBe(1);
    expect(supervisor.diagnostics().nextDelayMs).toBe(500);
    expect(supervisor.diagnostics().nextDelayMs).toBeGreaterThanOrEqual(400);
    expect(supervisor.diagnostics().nextDelayMs).toBeLessThanOrEqual(600);
    supervisor.dispose();
  });

  it('increases delay exponentially and never exceeds the maximum', () => {
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/exponential', reconnectBaseDelayMs: 500,
      reconnectMaxDelayMs: 2_000, reconnectJitterRatio: 0,
    });
    supervisor.start();
    FakeWebSocket.instances[0].emitClose();
    expect(supervisor.diagnostics().nextDelayMs).toBe(500);
    vi.advanceTimersByTime(500);
    FakeWebSocket.instances[1].emitClose();
    expect(supervisor.diagnostics().nextDelayMs).toBe(1_000);
    vi.advanceTimersByTime(1_000);
    FakeWebSocket.instances[2].emitClose();
    expect(supervisor.diagnostics().nextDelayMs).toBe(2_000);
    vi.advanceTimersByTime(2_000);
    FakeWebSocket.instances[3].emitClose();
    expect(supervisor.diagnostics().nextDelayMs).toBe(2_000);
    supervisor.dispose();
  });

  it('keeps jitter deterministic and within configured bounds', () => {
    const create = () => createWebSocketSupervisor({
      url: 'wss://example.test/jitter', reconnectBaseDelayMs: 1_000,
      reconnectJitterRatio: 0.25, random: () => 0.1,
    });
    const first = create();
    first.start();
    FakeWebSocket.instances[0].emitClose();
    const firstDelay = first.diagnostics().nextDelayMs;
    first.dispose();
    FakeWebSocket.instances = [];
    const second = create();
    second.start();
    FakeWebSocket.instances[0].emitClose();
    const secondDelay = second.diagnostics().nextDelayMs;
    expect(firstDelay).toBe(secondDelay);
    expect(firstDelay).toBeGreaterThanOrEqual(750);
    expect(firstDelay).toBeLessThanOrEqual(1_250);
    second.dispose();
  });

  it('does not reset retries on open, only after healthy synchronization', () => {
    let healthy = false;
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/health-reset', reconnectBaseDelayMs: 500,
      reconnectJitterRatio: 0, isHealthy: () => healthy,
    });
    supervisor.start();
    FakeWebSocket.instances[0].emitClose();
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1];
    second.emitOpen();
    expect(supervisor.diagnostics().retryAttempt).toBe(1);
    second.emitMessage();
    expect(supervisor.diagnostics().retryAttempt).toBe(1);
    healthy = true;
    second.emitMessage();
    expect(supervisor.diagnostics().retryAttempt).toBe(0);
    second.emitClose();
    expect(supervisor.diagnostics().nextDelayMs).toBe(500);
    supervisor.dispose();
  });

  it('does not create parallel retries from rapid error and close events', () => {
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/rapid-failure', reconnectBaseDelayMs: 500,
      reconnectJitterRatio: 0,
    });
    supervisor.start();
    const first = FakeWebSocket.instances[0];
    first.emitError();
    first.emitClose();
    first.emitError();
    first.emitClose();
    expect(supervisor.diagnostics().retryAttempt).toBe(1);
    expect(supervisor.diagnostics().reconnectPending).toBe(true);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    supervisor.dispose();
  });


  it('pauses pending reconnect work while offline and resumes with one fresh socket', () => {
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/offline', reconnectDelayMs: 500,
    });
    supervisor.start();
    FakeWebSocket.instances[0].emitClose();
    expect(supervisor.diagnostics().reconnectPending).toBe(true);
    supervisor.suspend();
    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(supervisor.resume()).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    supervisor.dispose();
  });

  it('forces a fresh epoch for sleep/wake recovery without accepting old callbacks', () => {
    const messages: string[] = [];
    const supervisor = createWebSocketSupervisor({
      url: 'wss://example.test/restart',
      onMessage: (event) => messages.push(event.data),
    });
    supervisor.start();
    const first = FakeWebSocket.instances[0];
    supervisor.restart();
    const second = FakeWebSocket.instances[1];
    first.emitMessage('old');
    second.emitMessage('current');
    expect(first.closed).toBe(true);
    expect(messages).toEqual(['current']);
    expect(supervisor.diagnostics().reconnectPending).toBe(false);
    supervisor.dispose();
  });
});
