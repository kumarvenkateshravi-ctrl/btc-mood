import type { Timeframe } from './types';

export type HistoricalOperation = 'lazy' | 'deep' | 'history-window' | 'repair';

export interface HistoricalRequestIdentity {
  symbol: string;
  timeframe: Timeframe;
  generation: number;
  operation: HistoricalOperation;
  requestId: number;
}

export interface HistoricalRequest {
  identity: HistoricalRequestIdentity;
  signal: AbortSignal;
  abort: () => void;
  isCurrent: () => boolean;
  ifCurrent: (commit: () => void) => boolean;
  finish: () => void;
}

/**
 * Tracks in-flight historical operations. A context change invalidates every
 * request; a new request for the same symbol/timeframe supersedes the prior
 * operation. Both conditions are required to reject an ABA response safely.
 */
export class HistoricalRequestGate {
  private generation = 0;
  private nextRequestId = 0;
  private active = new Map<string, { requestId: number; controller: AbortController }>();

  invalidate() {
    this.generation += 1;
    for (const request of this.active.values()) request.controller.abort();
    this.active.clear();
  }

  begin(symbol: string, timeframe: Timeframe, operation: HistoricalOperation): HistoricalRequest {
    const key = `${symbol}:${timeframe}`;
    this.active.get(key)?.controller.abort();

    const controller = new AbortController();
    const identity: HistoricalRequestIdentity = {
      symbol,
      timeframe,
      generation: this.generation,
      operation,
      requestId: ++this.nextRequestId,
    };
    this.active.set(key, { requestId: identity.requestId, controller });

    const isCurrent = () => {
      const current = this.active.get(key);
      return (
        !controller.signal.aborted &&
        identity.generation === this.generation &&
        current?.requestId === identity.requestId
      );
    };

    return {
      identity,
      signal: controller.signal,
      abort: () => controller.abort(),
      isCurrent,
      ifCurrent: (commit) => {
        if (!isCurrent()) return false;
        commit();
        return true;
      },
      finish: () => {
        if (this.active.get(key)?.requestId === identity.requestId) this.active.delete(key);
      },
    };
  }
}
