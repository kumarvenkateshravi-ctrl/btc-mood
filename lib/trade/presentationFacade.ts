import { useCallback, useMemo } from 'react';
import { usePaperStoreSelector, type PaperStoreState } from '../paperStore';
import { useReplaySessionSelector, type ReplaySessionState } from '../replaySession';
import type { PaperPosition, PaperTrade } from '../paper';
import {
  resolveTradePresentation,
  type PaperPresentationSnapshot,
  type ReplayPresentationSnapshot,
  type TradePresentation,
  type ExecutionPresentationMode,
} from './presentation';

export interface PaperStorePresentationState {
  positions: Record<string, PaperPosition | null | undefined>;
  trades: PaperTrade[];
  balance: number;
  initialBalance: number;
}

export interface PaperPresentationSlice {
  position: PaperPosition | null;
  trades: PaperTrade[];
  balance: number;
  initialBalance: number;
}

export interface ReplayPresentationSlice {
  active: boolean;
  symbol: string;
  position: PaperPosition | null;
  trades: PaperTrade[];
  startBalance: number;
}

export interface TradePresentationFacade extends TradePresentation {
  /** Current mark only when it is valid for the active execution mode. */
  markPrice: number | null;
  markTrusted: boolean;
}

const EMPTY_PAPER_SLICE: PaperPresentationSlice = {
  position: null,
  trades: [],
  balance: 0,
  initialBalance: 0,
};

const EMPTY_REPLAY_SLICE: ReplayPresentationSlice = {
  active: false,
  symbol: '',
  position: null,
  trades: [],
  startBalance: 0,
};

function sameTradeArray(a: PaperTrade[], b: PaperTrade[]): boolean {
  return a === b || (a.length === b.length && a.every((trade, index) => trade === b[index]));
}

export function equalPaperPresentationSlice(a: PaperPresentationSlice, b: PaperPresentationSlice): boolean {
  return a.position === b.position
    && a.balance === b.balance
    && a.initialBalance === b.initialBalance
    && sameTradeArray(a.trades, b.trades);
}

export function equalReplayPresentationSlice(a: ReplayPresentationSlice, b: ReplayPresentationSlice): boolean {
  return a.active === b.active
    && a.symbol === b.symbol
    && a.position === b.position
    && a.startBalance === b.startBalance
    && sameTradeArray(a.trades, b.trades);
}

export function selectPaperPresentationSlice(state: PaperStoreState | PaperStorePresentationState, symbol: string): PaperPresentationSlice {
  return {
    position: state.positions[symbol] ?? null,
    trades: state.trades.filter((trade) => trade.symbol === symbol),
    balance: state.balance,
    initialBalance: state.initialBalance,
  };
}

export function selectReplayPresentationSlice(state: ReplaySessionState, symbol: string): ReplayPresentationSlice {
  if (!state.active || state.symbol !== symbol) return EMPTY_REPLAY_SLICE;
  return {
    active: true,
    symbol: state.symbol,
    position: state.position,
    trades: state.trades.filter((trade) => trade.symbol === symbol),
    startBalance: state.startBalance,
  };
}

export function deriveTradePresentationFacade(input: {
  mode: ExecutionPresentationMode;
  symbol: string;
  markPrice: number | null;
  markTrusted: boolean;
  paper: PaperPresentationSlice | PaperStorePresentationState;
  replay: ReplayPresentationSlice | ReplaySessionState;
}): TradePresentationFacade {
  const paperSlice = 'position' in input.paper
    ? input.paper
    : selectPaperPresentationSlice(input.paper, input.symbol);
  const replaySlice = 'active' in input.replay && 'startBalance' in input.replay && !('config' in input.replay)
    ? input.replay
    : selectReplayPresentationSlice(input.replay as ReplaySessionState, input.symbol);
  const paper: PaperPresentationSnapshot = {
    positions: { [input.symbol]: paperSlice.position },
    trades: paperSlice.trades,
    balance: paperSlice.balance,
    initialBalance: paperSlice.initialBalance,
  };
  const replay: ReplayPresentationSnapshot = {
    active: replaySlice.active,
    symbol: replaySlice.symbol,
    position: replaySlice.position,
    trades: replaySlice.trades,
    startBalance: replaySlice.startBalance,
  };
  const presentation = resolveTradePresentation({ mode: input.mode, symbol: input.symbol, paper, replay });
  const markTrusted = input.mode === 'replay'
    ? replaySlice.active && replaySlice.symbol === input.symbol && Number.isFinite(input.markPrice)
    : input.markTrusted && Number.isFinite(input.markPrice);
  return {
    ...presentation,
    markPrice: markTrusted ? input.markPrice : null,
    markTrusted,
  };
}

/** Shared active-chart facade: one narrow subscription composition for all consumers. */
export function useActiveTradePresentation(input: {
  mode: ExecutionPresentationMode;
  symbol: string;
  markPrice: number | null;
  markTrusted: boolean;
}): TradePresentationFacade {
  const paperSelector = useCallback(
    (state: PaperStoreState) => input.mode === 'live' ? selectPaperPresentationSlice(state, input.symbol) : EMPTY_PAPER_SLICE,
    [input.mode, input.symbol],
  );
  const replaySelector = useCallback(
    (state: ReplaySessionState) => input.mode === 'replay' ? selectReplayPresentationSlice(state, input.symbol) : EMPTY_REPLAY_SLICE,
    [input.mode, input.symbol],
  );
  const paper = usePaperStoreSelector(paperSelector, equalPaperPresentationSlice);
  const replay = useReplaySessionSelector(replaySelector, equalReplayPresentationSlice);
  return useMemo(
    () => deriveTradePresentationFacade({ mode: input.mode, symbol: input.symbol, markPrice: input.markPrice, markTrusted: input.markTrusted, paper, replay }),
    [input.mode, input.symbol, input.markPrice, input.markTrusted, paper, replay],
  );
}

