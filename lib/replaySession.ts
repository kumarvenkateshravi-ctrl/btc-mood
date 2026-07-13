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
import { intrabarSubBars } from './replay/intrabar';
import {
  positionSizeFor,
  DEFAULT_SESSION_CONFIG,
  type SessionConfig,
  type SizingResult,
  type TradeBehavior,
} from './replay/sessionSim';

export interface ReplaySessionState {
  active: boolean;
  symbol: string;
  position: PaperPosition | null;
  trades: PaperTrade[];
  startBalance: number;
  /** Trading-session config (null = watch-only replay, no simulator). */
  config: SessionConfig | null;
  /** Pre-trade levels for the NEXT order (spec: stop first, then size). */
  pendingSl: number | null;
  pendingTp: number | null;
  /** Behavior record for the open position (finalized into `behaviors`). */
  openBehavior: TradeBehavior | null;
  behaviors: TradeBehavior[];
}

const INITIAL: ReplaySessionState = {
  active: false,
  symbol: '',
  position: null,
  trades: [],
  startBalance: INITIAL_PAPER_BALANCE,
  config: null,
  pendingSl: null,
  pendingTp: null,
  openBehavior: null,
  behaviors: [],
};

// Prefill for the next session's setup form (sticky across replays).
let lastConfig: SessionConfig = DEFAULT_SESSION_CONFIG;
export function getLastSessionConfig(): SessionConfig {
  return lastConfig;
}

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
  set({ ...INITIAL, active: true, symbol });
}

/** Arm the trading simulator: account currency/balance/commission/leverage/risk. */
export function configureReplaySession(cfg: SessionConfig) {
  lastConfig = cfg;
  set({ ...state, config: cfg, startBalance: cfg.startBalance });
}

export function setPendingLevels(sl: number | null, tp: number | null) {
  set({ ...state, pendingSl: sl, pendingTp: tp });
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

/**
 * Instant risk-sized execution (spec steps 4-6): stop must exist, size is
 * riskAmount / |entry - stop|, one position at a time, margin reserved.
 * Returns the sizing result so the HUD can explain any refusal.
 */
export function replayOpenWithRisk(side: Side, mark: number, ts: number): SizingResult & { blocked?: 'position-open' | 'no-session' } {
  const none: SizingResult = { ok: false, units: 0, riskAmount: 0, margin: 0, reason: 'bad-input' };
  if (!state.active || !state.config) return { ...none, blocked: 'no-session' };
  if (state.position && state.position.side !== 'flat') return { ...none, blocked: 'position-open' };
  const cfg = state.config;
  const sizing = positionSizeFor(cfg, sessionBalance(state), side, mark, state.pendingSl);
  if (!sizing.ok) return sizing;
  const price = marketFillPrice(side, mark);
  const fill: PaperFill = {
    orderId: fillId('rs'),
    side,
    units: sizing.units,
    price,
    feeRate: cfg.commissionRate,
    fee: sizing.units * price * cfg.commissionRate,
    ts,
    leverage: cfg.leverage,
  };
  const out = applyFill(state.position, fill, state.symbol, ts, cfg.leverage);
  const position = normalize(out.position);
  const withLevels = position ? { ...position, sl: state.pendingSl, tp: state.pendingTp } : position;
  set({
    ...state,
    position: withLevels,
    trades: out.trade ? [out.trade, ...state.trades] : state.trades,
    openBehavior: withLevels
      ? {
          positionId: withLevels.id,
          slMoves: 0,
          plannedRisk: sizing.riskAmount,
          plannedTp: state.pendingTp,
          entryPrice: price,
          side: withLevels.side === 'long' ? 'long' : 'short',
          maxFavorablePrice: price,
        }
      : null,
  });
  return sizing;
}

export function replaySetOverlay(field: 'tp' | 'sl', value: number | null) {
  if (!state.position || state.position.side === 'flat') return;
  const openBehavior =
    field === 'sl' && state.openBehavior
      ? { ...state.openBehavior, slMoves: state.openBehavior.slMoves + 1 }
      : state.openBehavior;
  set({ ...state, position: { ...state.position, [field]: value }, openBehavior });
}

/** Finalize the behavior record when the open position fully closes. */
function finalizeBehavior(
  st: ReplaySessionState,
  closedTrades: PaperTrade[],
  stillOpen: PaperPosition | null,
  exitKind: 'tp' | 'sl' | 'manual' | 'infer',
): Pick<ReplaySessionState, 'openBehavior' | 'behaviors'> {
  if (!st.openBehavior || stillOpen || closedTrades.length === 0) {
    return { openBehavior: st.openBehavior, behaviors: st.behaviors };
  }
  const t = closedTrades[0];
  let kind: 'tp' | 'sl' | 'manual' = exitKind === 'infer' ? 'manual' : exitKind;
  if (exitKind === 'infer') {
    const exit = t.exitPrice ?? t.price;
    const near = (lvl: number | null | undefined) => lvl != null && Math.abs(exit - lvl) <= Math.max(0.5, lvl * 0.0005);
    if (near(t.sl)) kind = 'sl';
    else if (near(t.tp)) kind = 'tp';
  }
  const done: TradeBehavior = {
    ...st.openBehavior,
    exitKind: kind,
    exitPrice: t.exitPrice ?? t.price,
    realizedPnl: t.realizedPnl,
  };
  return { openBehavior: null, behaviors: [done, ...st.behaviors] };
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
  const position = normalize(out.position);
  set({
    ...state,
    position,
    trades: out.trade ? [out.trade, ...state.trades] : state.trades,
    ...finalizeBehavior(state, out.trade ? [out.trade] : [], position, 'manual'),
  });
}

/**
 * Run one revealed replay bar against the session's open position, simulating
 * the intrabar tick path (O→L→H→C up / O→H→L→C down) so a bar containing both
 * TP and SL fills at the level touched FIRST — deterministic and realistic
 * instead of engine-block-order dependent.
 */
export function replayReconcileBar(bar: Candle) {
  if (!state.active || !state.position || state.position.side === 'flat') return;
  let position: PaperPosition | null = state.position;
  const newTrades: PaperTrade[] = [];
  for (const sub of intrabarSubBars(bar)) {
    if (!position || position.side === 'flat') break;
    const r = reconcile(position, sub, [], bar.time);
    position = r.position && r.position.side !== 'flat' ? r.position : null;
    if (r.trades.length > 0) newTrades.push(...r.trades);
  }
  // Behavioral tracking: most favorable price seen while open.
  let openBehavior = state.openBehavior;
  if (openBehavior) {
    const fav = openBehavior.side === 'long' ? bar.high : bar.low;
    const better = openBehavior.side === 'long' ? fav > openBehavior.maxFavorablePrice : fav < openBehavior.maxFavorablePrice;
    if (better) openBehavior = { ...openBehavior, maxFavorablePrice: fav };
  }
  if (newTrades.length === 0 && position === state.position && openBehavior === state.openBehavior) return;
  const midState = { ...state, openBehavior };
  set({
    ...midState,
    position,
    trades: newTrades.length > 0 ? [...newTrades.reverse(), ...state.trades] : state.trades,
    ...finalizeBehavior(midState, newTrades, position, 'infer'),
  });
}

export function useReplaySession(): ReplaySessionState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}
