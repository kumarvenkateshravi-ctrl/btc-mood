export type WebSocketTransportState = 'connecting' | 'open' | 'closed' | 'error';

export interface WebSocketSupervisorOptions {
  url: string;
  /** @deprecated Use reconnectBaseDelayMs. Kept for existing callers/tests. */
  reconnectDelayMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** Symmetric jitter as a fraction of the exponential delay (0.2 = ±20%). */
  reconnectJitterRatio?: number;
  /** Injectable [0, 1] source for deterministic tests and diagnostics. */
  random?: () => number;
  /** True only when the consumer has confirmed synchronized, trusted data. */
  isHealthy?: (epoch: number) => boolean;
  onState?: (state: WebSocketTransportState, epoch: number) => void;
  onOpen?: (epoch: number) => void;
  onMessage?: (event: MessageEvent, epoch: number) => void;
  onError?: (epoch: number) => void;
  onClose?: (epoch: number) => void;
}

export interface WebSocketSupervisorDiagnostics {
  epoch: number;
  disposed: boolean;
  reconnectPending: boolean;
  reconnecting: boolean;
  hasActiveSocket: boolean;
  retryAttempt: number;
  nextDelayMs: number | null;
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;

/**
 * Owns exactly one socket attempt at a time. Every callback closes over an
 * attempt epoch and socket identity; disposal and reconnection invalidate
 * both, so late browser events cannot reach a newer market-data session.
 */
export class WebSocketSupervisor {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private disposed = false;
  private suspended = false;
  private retryAttempt = 0;
  private nextDelayMs: number | null = null;

  constructor(private readonly options: WebSocketSupervisorOptions) {}

  start(): void {
    if (this.disposed || this.suspended || this.socket || this.reconnectTimer) return;
    this.connect();
  }

  /** Pause transport activity while the browser reports it is offline. */
  suspend(): void {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextDelayMs = null;
    const socket = this.socket;
    this.socket = null;
    this.epoch += 1;
    if (socket) {
      try { socket.close(); } catch { /* browser teardown can throw */ }
    }
  }

  /** Resume a paused connection with a fresh epoch; it still needs valid data. */
  resume(): boolean {
    if (this.disposed || !this.suspended) return false;
    this.suspended = false;
    this.connect();
    return true;
  }

  /** Forces a fresh epoch after a browser wake or silent-stall diagnosis. */
  restart(): void {
    if (this.disposed || this.suspended) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextDelayMs = null;
    const socket = this.socket;
    this.socket = null;
    // Invalidate callbacks before closing; browser close events from the old
    // attempt must never schedule another reconnect.
    this.epoch += 1;
    if (socket) {
      try { socket.close(); } catch { /* browser teardown can throw */ }
    }
    this.connect();
  }

  /** Resets retry growth only after the active feed is genuinely healthy. */
  markHealthy(epoch = this.epoch): void {
    if (!this.isCurrent(epoch)) return;
    this.retryAttempt = 0;
    this.nextDelayMs = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextDelayMs = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Browser implementations can throw while a socket is being torn down.
      }
    }
  }

  diagnostics(): Readonly<WebSocketSupervisorDiagnostics> {
    return {
      epoch: this.epoch,
      disposed: this.disposed,
      reconnectPending: this.reconnectTimer != null,
      reconnecting: this.reconnectTimer != null || (this.socket == null && this.retryAttempt > 0),
      hasActiveSocket: this.socket != null,
      retryAttempt: this.retryAttempt,
      nextDelayMs: this.nextDelayMs,
    };
  }

  private connect(): void {
    if (this.disposed || this.suspended || this.socket || this.reconnectTimer) return;
    const epoch = ++this.epoch;
    this.emitState('connecting', epoch);

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch {
      if (!this.isCurrent(epoch)) return;
      this.emitState('error', epoch);
      this.options.onError?.(epoch);
      this.scheduleReconnect(epoch);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (!this.isCurrent(epoch, socket)) return;
      this.emitState('open', epoch);
      this.options.onOpen?.(epoch);
    };
    socket.onmessage = (event) => {
      if (!this.isCurrent(epoch, socket)) return;
      this.options.onMessage?.(event, epoch);
      if (this.options.isHealthy?.(epoch)) this.markHealthy(epoch);
    };
    socket.onerror = () => {
      if (!this.isCurrent(epoch, socket)) return;
      this.emitState('error', epoch);
      this.options.onError?.(epoch);
    };
    socket.onclose = () => {
      if (!this.isCurrent(epoch, socket)) return;
      this.socket = null;
      this.emitState('closed', epoch);
      this.options.onClose?.(epoch);
      this.scheduleReconnect(epoch);
    };
  }

  private scheduleReconnect(epoch: number): void {
    if (this.suspended || !this.isCurrent(epoch) || this.reconnectTimer) return;
    const attempt = this.retryAttempt + 1;
    this.retryAttempt = attempt;
    const delay = this.computeReconnectDelay(attempt);
    this.nextDelayMs = delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextDelayMs = null;
      if (!this.isCurrent(epoch)) return;
      this.connect();
    }, delay);
  }

  private computeReconnectDelay(attempt: number): number {
    const legacyDelay = this.options.reconnectDelayMs;
    const base = Math.max(0, this.options.reconnectBaseDelayMs ?? legacyDelay ?? DEFAULT_RECONNECT_BASE_DELAY_MS);
    const maximum = Math.max(0, this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS);
    const jitterRatio = Math.max(0, this.options.reconnectJitterRatio ?? (legacyDelay == null ? DEFAULT_RECONNECT_JITTER_RATIO : 0));
    const exponential = Math.min(maximum, base * (2 ** Math.max(0, attempt - 1)));
    if (jitterRatio === 0) return Math.round(exponential);
    const random = this.options.random?.() ?? Math.random();
    const boundedRandom = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
    const jittered = exponential * (1 + ((boundedRandom * 2) - 1) * jitterRatio);
    return Math.round(Math.min(maximum, Math.max(0, jittered)));
  }

  private isCurrent(epoch: number, socket?: WebSocket): boolean {
    return !this.disposed && this.epoch === epoch && (socket == null || this.socket === socket);
  }

  private emitState(state: WebSocketTransportState, epoch: number): void {
    this.options.onState?.(state, epoch);
  }
}

export function createWebSocketSupervisor(options: WebSocketSupervisorOptions): WebSocketSupervisor {
  return new WebSocketSupervisor(options);
}
