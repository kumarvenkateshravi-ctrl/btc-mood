import { describe, expect, it } from 'vitest';
import { createDrawingSessionAdapter, drawingScopeChanged } from './drawingSessionAdapter';

describe('drawing session adapter', () => {
  it('keeps one symbol scope across timeframe changes', () => {
    const first = createDrawingSessionAdapter('BTCUSDT');
    const sameSymbol = createDrawingSessionAdapter('BTCUSDT');
    expect(first.scopeIdentity).toBe('symbol:BTCUSDT');
    expect(first.scopeKey).toBe(sameSymbol.scopeKey);
    expect(drawingScopeChanged(first, sameSymbol)).toBe(false);
  });

  it('switches drawing scope only when the symbol changes', () => {
    const btc = createDrawingSessionAdapter('BTCUSDT');
    const gold = createDrawingSessionAdapter('XAUUSD');
    expect(drawingScopeChanged(btc, gold)).toBe(true);
    expect(gold.scopeIdentity).toBe('symbol:XAUUSD');
  });

  it('does not scope drawings by execution mode or replay session', () => {
    const adapter = createDrawingSessionAdapter('BTCUSDT');
    expect(adapter.persistsAcrossTimeframe).toBe(true);
    expect(adapter.persistsAcrossMode).toBe(true);
  });

  it('normalizes only surrounding whitespace and preserves symbol identity', () => {
    expect(createDrawingSessionAdapter(' BTCUSDT ').scopeKey).toBe('BTCUSDT');
  });
});

