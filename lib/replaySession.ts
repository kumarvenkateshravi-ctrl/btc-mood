'use client';

// Isolated Bar-Replay trading session. A self-contained paper account
// (position + trades + balance) that is SEPARATE from the live paper store, so
// practicing in replay never touches the live account. Resets on each new
// replay. Reuses the pure engine in paper.ts.

import { useSyncExternalStore } from 'react';
import {
  applyFill,
  reconcile,
  marketFillPrice,
  INITIAL_PAPER_BALANCE,
  TAKER_FEE,
  type PaperFill,
  type PaperPosition,
  type PaperTrade,
  type Side,
} from './paper';
import type { Candle } from './types';

export interface ReplaySessionState {
  active: boolean;
  symbol: string;
  position: PaperPosition | null;
  trades: PaperTrade[];
  startBalance: number;
}

const INITIAL: ReplaySessionState = {
  active: false,
  symbol: '',
  position: null,
  trades: [],
  startBalance: INITIAL_PAPER_BALANCE,
};

let state: ReplaySessionState = INITIAL;
const listeners = new Set<() => void>();

function set(next: ReplaySessionState) {
  state = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Realized balance = starting balance + sum of closed-trade P&L. */
export function sessionBalance(s: ReplaySessionState): number {
  return s.startBalance + s.trades.reduce((a, t) => a + t.realizedPnl, 0);
}

export function startReplaySession(symbol: string) {
  set({ active: true, symbol, position: null, trades: [], startBalance: INITIAL_PAPER_BALANCE });
}

export function endReplaySession() {
  set({ ...state, active: false });
}

export function isReplaySessionActive(): boolean {
  return state.active;
}

const normalize = (p: PaperPosition): PaperPosition | null => (p.side === 'flat' ? null : p);

function fillId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function replayMarketOrder(side: Side, units: number, mark: number, ts: number, leverage: number) {
  if (!state.active || !(units > 0) || !(mark > 0)) return;
  const price = marketFillPrice(side, mark);
  const fill: PaperFill = {
    orderId: fillId('rs'),
    side,
    units,
    price,
    feeRate: TAKER_FEE,
    fee: units * price * TAKER_FEE,
    ts,
    leverage,
  };
  const out = applyFill(state.position, fill, state.symbol, ts, leverage);
  set({
    ...state,
    position: normalize(out.position),
    trades: out.trade ? [out.trade, ...state.trades] : state.trades,
  });
}

export function replaySetOverlay(field: 'tp' | 'sl', value: number | null) {
  if (!state.position || state.position.side === 'flat') return;
  set({ ...state, position: { ...state.position, [field]: value } });
}

export function replayClose(mark: number, ts: number) {
  const pos = state.position;
  if (!pos || pos.side === 'flat' || pos.units <= 0) return;
  const side: Side = pos.side === 'long' ? 'sell' : 'buy';
  const price = marketFillPrice(side, mark);
  const fill: PaperFill = {
    orderId: fillId('rsClose'),
    side,
    units: pos.units,
    price,
    feeRate: TAKER_FEE,
    fee: pos.units * price * TAKER_FEE,
    ts,
    leverage: pos.leverage,
  };
  const out = applyFill(pos, fill, state.symbol, ts, pos.leverage);
  set({
    ...state,
    position: normalize(out.position),
    trades: out.trade ? [out.trade, ...state.trades] : state.trades,
  });
}

/** Run one revealed replay bar against the session's open position. */
export function replayReconcileBar(bar: Candle) {
  if (!state.active || !state.position || state.position.side === 'flat') return;
  const r = reconcile(state.position, bar, [], bar.time);
  if (r.trades.length === 0 && r.position === state.position) return;
  set({
    ...state,
    position: r.position && r.position.side !== 'flat' ? r.position : null,
    trades: r.trades.length > 0 ? [...r.trades, ...state.trades] : state.trades,
  });
}

export function useReplaySession(): ReplaySessionState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}
