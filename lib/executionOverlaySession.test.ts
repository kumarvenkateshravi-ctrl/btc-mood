import { describe, expect, it } from 'vitest';
import type { TradePresentationFacade } from './trade/presentationFacade';
import type { PaperPosition } from './paper';
import {
  deriveExecutionOverlaySession,
  draftForSession,
  overlaySide,
  transitionExecutionOverlay,
} from './executionOverlaySession';

const basePresentation = (overrides: Partial<TradePresentationFacade> = {}): TradePresentationFacade => ({
  mode: 'live',
  symbol: 'BTCUSDT',
  position: null,
  trades: [],
  balance: 1000,
  initialBalance: 1000,
  markPrice: 100,
  markTrusted: true,
  ...overrides,
});

const position = (overrides: Partial<PaperPosition> = {}): PaperPosition => ({
  id: 'pos-1',
  symbol: 'BTCUSDT',
  side: 'long',
  units: 2,
  entryPrice: 100,
  realizedPnl: 0,
  feesPaid: 0,
  openedAt: 1,
  tp: 110,
  sl: 95,
  liquidated: false,
  leverage: 1,
  trailingSl: false,
  trailingBest: null,
  ...overrides,
});

describe('execution overlay session adapter', () => {
  it('derives the authoritative active position and side', () => {
    const session = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position() }) });
    expect(session).toMatchObject({ mode: 'live', symbol: 'BTCUSDT', positionId: 'pos-1', side: 'long', active: true });
    expect(overlaySide(session)).toBe('buy');
  });

  it('clears execution presentation identity on full close/flat transition', () => {
    const open = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position() }) });
    const flat = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation() });
    expect(transitionExecutionOverlay(open, flat).resetTransientState).toBe(true);
    expect(flat.active).toBe(false);
    expect(overlaySide(flat)).toBeNull();
    expect(draftForSession({ tp: 110, sl: 95 }, open.resetKey, flat)).toBeNull();
  });

  it('updates remaining position after a partial close without clearing the session', () => {
    const before = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position({ units: 4 }) }) });
    const after = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position({ units: 3 }) }) });
    expect(after.positionId).toBe(before.positionId);
    expect(transitionExecutionOverlay(before, after).resetTransientState).toBe(false);
  });

  it('resets on reversal, symbol change, mode change, and wrong-symbol presentation', () => {
    const open = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position() }) });
    const reversed = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position({ id: 'pos-2', side: 'short' }) }) });
    const symbol = deriveExecutionOverlaySession({ mode: 'live', symbol: 'XAUUSD', presentation: basePresentation({ symbol: 'XAUUSD', position: position({ symbol: 'XAUUSD' }) }) });
    const replay = deriveExecutionOverlaySession({ mode: 'replay', symbol: 'BTCUSDT', presentation: basePresentation({ mode: 'replay', position: null }) });
    const wrong = deriveExecutionOverlaySession({ mode: 'live', symbol: 'XAUUSD', presentation: basePresentation({ position: position() }) });
    expect(transitionExecutionOverlay(open, reversed).resetTransientState).toBe(true);
    expect(transitionExecutionOverlay(open, symbol).resetTransientState).toBe(true);
    expect(transitionExecutionOverlay(open, replay).resetTransientState).toBe(true);
    expect(wrong.active).toBe(false);
  });

  it('keeps a draft only for its exact active session', () => {
    const session = deriveExecutionOverlaySession({ mode: 'live', symbol: 'BTCUSDT', presentation: basePresentation({ position: position() }) });
    expect(draftForSession({ tp: 111, sl: 94 }, session.resetKey, session)).toEqual({ tp: 111, sl: 94 });
    expect(draftForSession({ tp: 111, sl: 94 }, 'live:BTCUSDT:other:long', session)).toBeNull();
  });
});

