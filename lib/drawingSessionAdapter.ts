/**
 * User drawings are intentionally scoped by symbol only.  This adapter makes
 * that ownership explicit at the chart-session boundary without changing the
 * existing persistence format or the undo/redo store.
 */
export interface DrawingSessionAdapter {
  readonly symbol: string;
  readonly scopeIdentity: string;
  readonly scopeKey: string;
  /** Drawings survive visual timeframe and live/replay transitions. */
  readonly persistsAcrossTimeframe: true;
  readonly persistsAcrossMode: true;
}

export function createDrawingSessionAdapter(symbol: string): DrawingSessionAdapter {
  const normalized = symbol.trim();
  return Object.freeze({
    symbol: normalized,
    scopeIdentity: `symbol:${normalized}`,
    scopeKey: normalized,
    persistsAcrossTimeframe: true as const,
    persistsAcrossMode: true as const,
  });
}

/** A symbol transition changes drawing scope; all other chart transitions do not. */
export function drawingScopeChanged(previous: DrawingSessionAdapter | null, next: DrawingSessionAdapter): boolean {
  return previous !== null && previous.scopeKey !== next.scopeKey;
}

