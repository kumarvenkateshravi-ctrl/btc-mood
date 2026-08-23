// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackoffRetry, bindBrowserLifecycleRecovery, MarketDataRecoveryCoordinator } from './recovery';

describe('market-data recovery coordination', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dedupes concurrent lifecycle recovery signals into one operation', async () => {
    const recover = vi.fn(async () => {});
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    coordinator.request('visibilitychange');
    coordinator.request('pageshow');
    coordinator.request('online');
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('prevents recovery while offline and performs one recovery after online', async () => {
    const recover = vi.fn(async () => {});
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    coordinator.setOffline(true);
    coordinator.request('stale');
    await vi.runAllTimersAsync();
    expect(recover).not.toHaveBeenCalled();
    coordinator.setOffline(false);
    coordinator.request('online');
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('does not overlap an active asynchronous recovery', async () => {
    let release!: () => void;
    const recover = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    coordinator.request('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    coordinator.request('pageshow');
    expect(recover).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    coordinator.dispose();
  });
});

describe('browser lifecycle bindings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recovers once for clustered visible/pageshow events and pauses work offline', async () => {
    const recover = vi.fn(async () => {});
    const coordinator = new MarketDataRecoveryCoordinator({ recover });
    const offline = vi.fn(() => coordinator.setOffline(true));
    const online = vi.fn(() => { coordinator.setOffline(false); coordinator.request('online'); });
    const dispose = bindBrowserLifecycleRecovery({ coordinator, onOffline: offline, onOnline: online });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    await vi.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('pageshow'));
    await vi.runAllTimersAsync();
    expect(offline).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await vi.runAllTimersAsync();
    expect(online).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(2);
    dispose();
    coordinator.dispose();
  });
});

describe('bounded gap-repair retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses deterministic bounded exponential backoff and only one pending retry', () => {
    const retry = new BackoffRetry({ baseDelayMs: 500, maxDelayMs: 2_000, jitterRatio: 0.2, random: () => 1 });
    const callback = vi.fn();
    expect(retry.schedule(callback)).toBe(600);
    expect(retry.schedule(callback)).toBeNull();
    vi.advanceTimersByTime(600);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(retry.schedule(callback)).toBe(1_200);
    vi.advanceTimersByTime(1_200);
    expect(retry.schedule(callback)).toBe(2_000);
    retry.dispose();
  });

  it('does not invoke stale or disposed retry callbacks', () => {
    const retry = new BackoffRetry({ baseDelayMs: 500, maxDelayMs: 2_000, jitterRatio: 0 });
    const callback = vi.fn();
    retry.schedule(callback, () => false);
    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
    retry.schedule(callback);
    retry.dispose();
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('resets retry growth after a successful repair', () => {
    const retry = new BackoffRetry({ baseDelayMs: 500, maxDelayMs: 2_000, jitterRatio: 0 });
    const callback = vi.fn();
    expect(retry.schedule(callback)).toBe(500);
    vi.advanceTimersByTime(500);
    retry.reset();
    expect(retry.schedule(callback)).toBe(500);
    retry.dispose();
  });
});
