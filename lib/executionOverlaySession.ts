import type { TradePresentationFacade } from './trade/presentationFacade';

export type OverlaySessionMode = 'live' | 'replay';
export type OverlayPositionSide = 'long' | 'short' | 'flat';

/**
 * The execution-overlay lifecycle is deliberately derived, not stored.  The
 * account/presentation facade remains the authority for every displayed
 * execution value; this adapter only supplies a stable transition identity
 * for transient UI state (draft levels and confirmation dialogs).
 */
export interface ExecutionOverlaySession {
  readonly mode: OverlaySessionMode;
  readonly symbol: string;
  readonly positionId: string | null;
  readonly side: OverlayPositionSide;
  readonly active: boolean;
  readonly resetKey: string;
}

export interface OverlayDraft {
  tp: number | null;
  sl: number | null;
}

export interface ExecutionOverlayTransition {
  readonly session: ExecutionOverlaySession;
  readonly resetTransientState: boolean;
}

/** Derive the active execution presentation identity for the current chart. */
export function deriveExecutionOverlaySession(input: {
  mode: OverlaySessionMode;
  symbol: string;
  presentation: TradePresentationFacade;
}): ExecutionOverlaySession {
  const position = input.presentation.mode === input.mode && input.presentation.symbol === input.symbol
    ? input.presentation.position
    : null;
  const side = position && position.units > 0 && position.side !== 'flat' ? position.side : 'flat';
  const positionId = side === 'flat' ? null : position?.id ?? null;
  const active = positionId !== null;
  const resetKey = [input.mode, input.symbol, positionId ?? 'flat', side].join(':');
  return Object.freeze({
    mode: input.mode,
    symbol: input.symbol,
    positionId,
    side,
    active,
    resetKey,
  });
}

/**
 * Return a transition record.  Drafts are UI-only and must be discarded when
 * execution ownership, symbol, position identity, side, or flat state changes.
 */
export function transitionExecutionOverlay(
  previous: ExecutionOverlaySession | null,
  next: ExecutionOverlaySession,
): ExecutionOverlayTransition {
  return {
    session: next,
    resetTransientState: previous === null || previous.resetKey !== next.resetKey,
  };
}

/** Guard against accidentally carrying a draft into a different execution session. */
export function draftForSession(
  draft: OverlayDraft | null,
  draftSessionKey: string | null,
  session: ExecutionOverlaySession,
): OverlayDraft | null {
  return draft && draftSessionKey === session.resetKey && session.active ? draft : null;
}

/** Small pure helper used by tests and transition code. */
export function overlaySide(session: ExecutionOverlaySession): 'buy' | 'sell' | null {
  if (!session.active) return null;
  return session.side === 'long' ? 'buy' : 'sell';
}

