export interface RecoveryCoordinatorOptions {
  /** Runs once after coalescing lifecycle/staleness signals. */
  recover: () => void | Promise<void>;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Coalesces browser lifecycle signals without assuming a transport is healthy
 * merely because its socket is open. A recovery is never run while offline or
 * concurrently with another recovery; the caller decides what "recovered"
 * means by re-checking feed health and synchronization afterwards.
 */
export class MarketDataRecoveryCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private offline = false;
  private disposed = false;
  private generation = 0;

  constructor(private readonly options: RecoveryCoordinatorOptions) {}

  request(_reason: 'visibilitychange' | 'pageshow' | 'online' | 'stale' | 'manual' = 'manual'): void {
    if (this.disposed || this.offline || this.running || this.timer) return;
    const generation = this.generation;
    const schedule = this.options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.timer = schedule(() => {
      this.timer = null;
      if (this.disposed || this.offline || this.running || generation !== this.generation) return;
      this.running = true;
      Promise.resolve(this.options.recover()).finally(() => {
        if (!this.disposed && generation === this.generation) this.running = false;
      });
    }, 0);
  }

  setOffline(offline: boolean): void {
    if (this.disposed || this.offline === offline) return;
    this.offline = offline;
    if (offline) {
      this.generation += 1;
      this.clearTimer();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = null;
  }
}

export interface BrowserLifecycleRecoveryOptions {
  coordinator: MarketDataRecoveryCoordinator;
  onOffline: () => void;
  onOnline: () => void;
  document?: Document;
  window?: Window;
}

/** Bind lifecycle events once per market-data session. Kept separate from the
 * hook so browser sleep/wake behavior is deterministic and directly testable. */
export function bindBrowserLifecycleRecovery({
  coordinator,
  onOffline,
  onOnline,
  document: doc = document,
  window: win = window,
}: BrowserLifecycleRecoveryOptions): () => void {
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') coordinator.request('visibilitychange');
  };
  const onPageShow = () => coordinator.request('pageshow');
  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('offline', onOffline);
  win.addEventListener('online', onOnline);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('offline', onOffline);
    win.removeEventListener('online', onOnline);
  };
}

export interface BackoffRetryOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER_RATIO = 0.2;

/** One bounded retry chain. It has no transport knowledge, so it safely
 * reuses the same policy as the websocket supervisor for REST repair retries. */
export class BackoffRetry {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;

  constructor(private readonly options: BackoffRetryOptions = {}) {}

  schedule(callback: () => void, isCurrent: () => boolean = () => true): number | null {
    if (this.disposed || this.timer) return null;
    const delay = this.computeDelay(++this.attempt);
    const schedule = this.options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = schedule(() => {
      this.timer = null;
      if (!this.disposed && isCurrent()) callback();
    }, delay);
    return delay;
  }

  /** Pause an in-flight retry without forgetting its bounded-backoff history. */
  cancel(): void {
    this.cancelPending();
  }

  /** Successful repair restores fast recovery for a future independent gap. */
  reset(): void {
    this.attempt = 0;
    this.cancelPending();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
  }

  diagnostics(): Readonly<{ attempt: number; pending: boolean }> {
    return { attempt: this.attempt, pending: this.timer != null };
  }

  private cancelPending(): void {
    if (!this.timer) return;
    (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = null;
  }

  private computeDelay(attempt: number): number {
    const base = Math.max(0, this.options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
    const maximum = Math.max(0, this.options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
    const jitterRatio = Math.max(0, this.options.jitterRatio ?? DEFAULT_JITTER_RATIO);
    const exponential = Math.min(maximum, base * (2 ** Math.max(0, attempt - 1)));
    if (jitterRatio === 0) return Math.round(exponential);
    const value = this.options.random?.() ?? Math.random();
    const random = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
    return Math.round(Math.min(maximum, Math.max(0, exponential * (1 + ((random * 2) - 1) * jitterRatio))));
  }
}
