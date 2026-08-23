'use client';

// Isolated Bar-Replay trading session. This account remains separate from the
// live paper store. Its accepted user actions are journaled so moving the
// replay head backwards can rebuild this session deterministically.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  applyFill,
  applyProtectionUpdate,
  reconcile,
  marketFillPrice,
  INITIAL_PAPER_BALANCE,
  type PaperFill,
  type PaperPosition,
  type PaperTrade,
  type Side,
  type ProtectionUpdate,
} from './paper';
import type { Candle, Timeframe } from './types';
import { intrabarSubBars } from './replay/intrabar';
import { getReplayDataset } from './replay/replayDataset';
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

export interface ReplayActionContext {
  /** Execution-timeframe index of the already-consumed replay candle. */
  barIndex: number;
  /** Start time of that execution candle. */
  cutTime: number;
}

type ReplayAction =
  | { id: string; kind: 'configure'; barIndex: number; cutTime: number; config: SessionConfig }
  | { id: string; kind: 'pending'; barIndex: number; cutTime: number; sl: number | null; tp: number | null }
  | { id: string; kind: 'market'; barIndex: number; cutTime: number; side: Side; units: number; mark: number; ts: number; leverage: number }
  | { id: string; kind: 'risk-open'; barIndex: number; cutTime: number; side: Side; mark: number; ts: number }
  | { id: string; kind: 'overlay'; barIndex: number; cutTime: number; field: 'tp' | 'sl'; value: number | null }
  | { id: string; kind: 'close'; barIndex: number; cutTime: number; mark: number; ts: number }
  | { id: string; kind: 'partial-close'; barIndex: number; cutTime: number; units: number; mark: number; ts: number }
  | { id: string; kind: 'protection'; barIndex: number; cutTime: number; sl?: number | null; tp?: number | null; trailingSl?: boolean };

type ReplayActionInput =
  | Omit<Extract<ReplayAction, { kind: 'configure' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'pending' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'market' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'risk-open' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'overlay' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'close' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'partial-close' }>, 'id' | 'barIndex' | 'cutTime'>
  | Omit<Extract<ReplayAction, { kind: 'protection' }>, 'id' | 'barIndex' | 'cutTime'>;
interface ReplayJournal {
  baseline: ReplaySessionState;
  startIndex: number;
  executionTf: Timeframe;
  context: ReplayActionContext;
  actions: ReplayAction[];
  nextSequence: number;
  /** Commission becomes immutable after the first accepted replay fill. */
  executionStarted: boolean;
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

let lastConfig: SessionConfig = DEFAULT_SESSION_CONFIG;
export function getLastSessionConfig(): SessionConfig {
  return lastConfig;
}

let state: ReplaySessionState = INITIAL;
let journal: ReplayJournal | null = null;
const listeners = new Set<() => void>();

function set(next: ReplaySessionState) {
  state = next;
  for (const listener of listeners) listener();
}

export const subscribeReplaySession = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getReplaySessionSnapshot = (): ReplaySessionState => state;

export function useReplaySessionSelector<T>(selector: (snapshot: ReplaySessionState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cacheRef = useRef<{ snapshot: ReplaySessionState; value: T } | null>(null);
  const getSelectedSnapshot = useCallback(() => {
    const snapshot = state;
    const cached = cacheRef.current;
    if (cached?.snapshot === snapshot) return cached.value;
    const next = selector(snapshot);
    if (cached !== null && isEqual(cached.value, next)) {
      cacheRef.current = { snapshot, value: cached.value };
      return cached.value;
    }
    cacheRef.current = { snapshot, value: next };
    return next;
  }, [selector, isEqual]);
  const getSelectedServerSnapshot = useCallback(() => selector(INITIAL), [selector]);
  return useSyncExternalStore(subscribeReplaySession, getSelectedSnapshot, getSelectedServerSnapshot);
}

function cloneConfig(config: SessionConfig): SessionConfig {
  return { ...config };
}

function cloneState(source: ReplaySessionState): ReplaySessionState {
  return {
    ...source,
    config: source.config ? cloneConfig(source.config) : null,
    position: source.position ? { ...source.position } : null,
    trades: source.trades.map((trade) => ({ ...trade })),
    openBehavior: source.openBehavior ? { ...source.openBehavior } : null,
    behaviors: source.behaviors.map((behavior) => ({ ...behavior })),
  };
}

function sameConfig(a: SessionConfig | null, b: SessionConfig): boolean {
  return a?.currency === b.currency
    && a.startBalance === b.startBalance
    && a.commissionRate === b.commissionRate
    && a.leverage === b.leverage
    && a.riskPct === b.riskPct;
}

function currentContext(): ReplayActionContext | null {
  return journal?.context ?? null;
}function replayCommissionRate(session: ReplaySessionState): number {
  const configured = session.config?.commissionRate ?? DEFAULT_SESSION_CONFIG.commissionRate;
  return Number.isFinite(configured) && configured >= 0 ? configured : 0;
}

function markExecutionStarted() {
  if (journal) journal.executionStarted = true;
}

function appendAction(action: ReplayActionInput): ReplayAction | null {
  if (!journal || !state.active) return null;
  const context = currentContext();
  if (!context) return null;
  const id = `action_${journal.nextSequence.toString(36)}`;
  journal.nextSequence += 1;
  const next = { ...action, id, barIndex: context.barIndex, cutTime: context.cutTime } as ReplayAction;
  journal.actions.push(next);
  return next;
}

/** Realized balance = starting balance + sum of closed-trade P&L. */
export function sessionBalance(session: ReplaySessionState): number {
  return session.startBalance + session.trades.reduce((total, trade) => total + trade.realizedPnl, 0);
}

export function startReplaySession(symbol: string, options: { startIndex?: number; executionTf?: Timeframe } = {}) {
  const startIndex = Math.max(1, Math.floor(options.startIndex ?? 1));
  const executionTf = options.executionTf ?? '15m';
  const baseline: ReplaySessionState = { ...INITIAL, active: true, symbol };
  journal = {
    baseline: cloneState(baseline),
    startIndex,
    executionTf,
    context: { barIndex: startIndex, cutTime: 0 },
    actions: [],
    nextSequence: 1,
    executionStarted: false,
  };
  set(baseline);
}

/** ChartPanel updates this at every execution-timeframe cut. */
export function setReplayActionContext(barIndex: number, cutTime: number) {
  if (!journal) return;
  journal.context = {
    barIndex: Math.max(journal.startIndex, Math.floor(barIndex)),
    cutTime,
  };
}

/** Arm the trading simulator: account currency/balance/commission/leverage/risk. */
export function configureReplaySession(config: SessionConfig) {
  if (!state.active || sameConfig(state.config, config) || journal?.executionStarted) return;
  lastConfig = cloneConfig(config);
  const action = appendAction({ kind: 'configure', config: cloneConfig(config) });
  if (!action) return;
  set(applyAction(state, action));
}

export function setPendingLevels(sl: number | null, tp: number | null) {
  if (!state.active || (state.pendingSl === sl && state.pendingTp === tp)) return;
  const action = appendAction({ kind: 'pending', sl, tp });
  if (!action) return;
  set(applyAction(state, action));
}

export function endReplaySession() {
  journal = null;
  set({ ...state, active: false });
}

export function isReplaySessionActive(): boolean {
  return state.active;
}

const normalize = (position: PaperPosition): PaperPosition | null => (position.side === 'flat' ? null : position);

function orderId(prefix: 'rs' | 'rsClose' | 'rsPartial', actionId: string): string {
  return `${prefix}_${actionId}`;
}

function applyMarket(
  session: ReplaySessionState,
  action: Extract<ReplayAction, { kind: 'market' }>,
): ReplaySessionState {
  const price = marketFillPrice(action.side, action.mark);
  const fill: PaperFill = {
    orderId: orderId('rs', action.id), side: action.side, units: action.units, price,
    feeRate: replayCommissionRate(session), fee: action.units * price * replayCommissionRate(session), ts: action.ts, leverage: action.leverage,
  };
  const out = applyFill(session.position, fill, session.symbol, action.ts, action.leverage);
  return {
    ...session,
    position: normalize(out.position),
    trades: out.trade ? [out.trade, ...session.trades] : session.trades,
  };
}

function riskOpen(
  session: ReplaySessionState,
  action: Extract<ReplayAction, { kind: 'risk-open' }>,
): { session: ReplaySessionState; sizing: SizingResult } {
  const none: SizingResult = { ok: false, units: 0, riskAmount: 0, margin: 0, reason: 'bad-input' };
  if (!session.active || !session.config || (session.position && session.position.side !== 'flat')) return { session, sizing: none };
  const config = session.config;
  const sizing = positionSizeFor(config, sessionBalance(session), action.side, action.mark, session.pendingSl);
  if (!sizing.ok) return { session, sizing };
  const price = marketFillPrice(action.side, action.mark);
  const fill: PaperFill = {
    orderId: orderId('rs', action.id), side: action.side, units: sizing.units, price,
    feeRate: replayCommissionRate(session), fee: sizing.units * price * replayCommissionRate(session), ts: action.ts, leverage: config.leverage,
  };
  const out = applyFill(session.position, fill, session.symbol, action.ts, config.leverage);
  const position = normalize(out.position);
  const withLevels = position ? { ...position, sl: session.pendingSl, tp: session.pendingTp } : position;
  return {
    sizing,
    session: {
      ...session,
      position: withLevels,
      trades: out.trade ? [out.trade, ...session.trades] : session.trades,
      openBehavior: withLevels
        ? {
            positionId: withLevels.id, slMoves: 0, plannedRisk: sizing.riskAmount,
            plannedTp: session.pendingTp, entryPrice: price,
            side: withLevels.side === 'long' ? 'long' : 'short', maxFavorablePrice: price,
          }
        : null,
    },
  };
}

/** Finalize the behavior record when the open position fully closes. */
function finalizeBehavior(
  session: ReplaySessionState,
  closedTrades: PaperTrade[],
  stillOpen: PaperPosition | null,
  exitKind: 'tp' | 'sl' | 'manual' | 'infer',
): Pick<ReplaySessionState, 'openBehavior' | 'behaviors'> {
  if (!session.openBehavior || stillOpen || closedTrades.length === 0) {
    return { openBehavior: session.openBehavior, behaviors: session.behaviors };
  }
  const trade = closedTrades[0];
  let kind: 'tp' | 'sl' | 'manual' = exitKind === 'infer' ? 'manual' : exitKind;
  if (exitKind === 'infer') {
    const exit = trade.exitPrice ?? trade.price;
    const near = (level: number | null | undefined) => level != null && Math.abs(exit - level) <= Math.max(0.5, level * 0.0005);
    if (near(trade.sl)) kind = 'sl';
    else if (near(trade.tp)) kind = 'tp';
  }
  const lifecycleRealizedPnl = [...closedTrades, ...session.trades]
    .filter((item) => item.positionId === session.openBehavior!.positionId)
    .reduce((total, item) => total + item.realizedPnl, 0);
  const done: TradeBehavior = {
    ...session.openBehavior, exitKind: kind, exitPrice: trade.exitPrice ?? trade.price, realizedPnl: lifecycleRealizedPnl,
  };
  return { openBehavior: null, behaviors: [done, ...session.behaviors] };
}

function applyClose(session: ReplaySessionState, action: Extract<ReplayAction, { kind: 'close' }>): ReplaySessionState {
  const position = session.position;
  if (!position || position.side === 'flat' || position.units <= 0) return session;
  const side: Side = position.side === 'long' ? 'sell' : 'buy';
  const price = marketFillPrice(side, action.mark);
  const fill: PaperFill = {
    orderId: orderId('rsClose', action.id), side, units: position.units, price,
    feeRate: replayCommissionRate(session), fee: position.units * price * replayCommissionRate(session), ts: action.ts, leverage: position.leverage,
  };
  const out = applyFill(position, fill, session.symbol, action.ts, position.leverage);
  const nextPosition = normalize(out.position);
  return {
    ...session,
    position: nextPosition,
    trades: out.trade ? [out.trade, ...session.trades] : session.trades,
    ...finalizeBehavior(session, out.trade ? [out.trade] : [], nextPosition, 'manual'),
  };
}

/**
 * Close a deterministic quantity while preserving the surviving position's
 * entry, brackets and trailing state. `applyFill` remains authoritative for
 * realized P&L, fee policy and trade-record construction; it receives a
 * close-sized view because its normal opposite-side path is full-close/reverse.
 */
function applyPartialClose(
  session: ReplaySessionState,
  action: Extract<ReplayAction, { kind: 'partial-close' }>,
): ReplaySessionState {
  const position = session.position;
  if (!position || position.side === 'flat' || position.units <= 0) return session;
  const units = Math.min(position.units, action.units);
  if (!(units > 0)) return session;
  const side: Side = position.side === 'long' ? 'sell' : 'buy';
  const price = marketFillPrice(side, action.mark);
  const fill: PaperFill = {
    orderId: orderId('rsPartial', action.id), side, units, price,
    feeRate: replayCommissionRate(session), fee: units * price * replayCommissionRate(session), ts: action.ts, leverage: position.leverage,
  };
  const closed = applyFill({ ...position, units }, fill, session.symbol, action.ts, position.leverage);
  const fullyClosed = units >= position.units;
  const nextPosition = fullyClosed
    ? normalize(closed.position)
    : {
        ...position,
        units: position.units - units,
        realizedPnl: closed.position.realizedPnl,
        feesPaid: closed.position.feesPaid,
      };
  const newTrades = closed.trade ? [closed.trade] : [];
  return {
    ...session,
    position: nextPosition,
    trades: closed.trade ? [closed.trade, ...session.trades] : session.trades,
    ...finalizeBehavior(session, newTrades, nextPosition, 'manual'),
  };
}

function applyReplayProtection(session: ReplaySessionState, input: ProtectionUpdate): ReplaySessionState {
  const position = session.position;
  if (!position || position.side === 'flat') return session;
  const result = applyProtectionUpdate(position, input);
  if (!result.ok) return session;
  const slChanged = result.position.sl !== position.sl;
  const openBehavior = slChanged && session.openBehavior
    ? { ...session.openBehavior, slMoves: session.openBehavior.slMoves + 1 }
    : session.openBehavior;
  return { ...session, position: result.position, openBehavior };
}

function applyAction(session: ReplaySessionState, action: ReplayAction): ReplaySessionState {
  switch (action.kind) {
    case 'configure': return { ...session, config: cloneConfig(action.config), startBalance: action.config.startBalance };
    case 'pending': return { ...session, pendingSl: action.sl, pendingTp: action.tp };
    case 'market': return applyMarket(session, action);
    case 'risk-open': return riskOpen(session, action).session;
    case 'overlay': return applyReplayProtection(session, { [action.field]: action.value });
    case 'protection': return applyReplayProtection(session, action);
    case 'partial-close': return applyPartialClose(session, action);
    case 'close': return applyClose(session, action);
  }
}

function reconcileSession(session: ReplaySessionState, bar: Candle): ReplaySessionState {
  if (!session.active || !session.position || session.position.side === 'flat') return session;
  let position: PaperPosition | null = session.position;
  const newTrades: PaperTrade[] = [];
  for (const sub of intrabarSubBars(bar)) {
    if (!position || position.side === 'flat') break;
    const rate = replayCommissionRate(session);
    const reconciled = reconcile(position, sub, [], bar.time, { takerFeeRate: rate, makerFeeRate: rate });
    position = reconciled.position && reconciled.position.side !== 'flat' ? reconciled.position : null;
    if (reconciled.trades.length > 0) newTrades.push(...reconciled.trades);
  }
  let openBehavior = session.openBehavior;
  if (openBehavior) {
    const favorable = openBehavior.side === 'long' ? bar.high : bar.low;
    const better = openBehavior.side === 'long' ? favorable > openBehavior.maxFavorablePrice : favorable < openBehavior.maxFavorablePrice;
    if (better) openBehavior = { ...openBehavior, maxFavorablePrice: favorable };
  }
  if (newTrades.length === 0 && position === session.position && openBehavior === session.openBehavior) return session;
  const midState = { ...session, openBehavior };
  return {
    ...midState,
    position,
    trades: newTrades.length > 0 ? [...newTrades.reverse(), ...session.trades] : session.trades,
    ...finalizeBehavior(midState, newTrades, position, 'infer'),
  };
}

export function replayMarketOrder(side: Side, units: number, mark: number, ts: number, leverage: number) {
  if (!state.active || !(units > 0) || !(mark > 0)) return;
  const action = appendAction({ kind: 'market', side, units, mark, ts, leverage });
  if (!action) return;
  markExecutionStarted();
  set(applyAction(state, action));
}

/** Instant risk-sized execution. Rejections are deliberately not journaled. */
export function replayOpenWithRisk(side: Side, mark: number, ts: number): SizingResult & { blocked?: 'position-open' | 'no-session' } {
  const none: SizingResult = { ok: false, units: 0, riskAmount: 0, margin: 0, reason: 'bad-input' };
  if (!state.active || !state.config) return { ...none, blocked: 'no-session' };
  if (state.position && state.position.side !== 'flat') return { ...none, blocked: 'position-open' };
  const preview: ReplayAction = { id: 'preview', kind: 'risk-open', barIndex: 0, cutTime: 0, side, mark, ts };
  const result = riskOpen(state, preview);
  if (!result.sizing.ok) return result.sizing;
  const action = appendAction({ kind: 'risk-open', side, mark, ts });
  if (!action) return { ...none, blocked: 'no-session' };
  markExecutionStarted();
  set(applyAction(state, action));
  return result.sizing;
}

export type ReplayProtectionCommandResult = { ok: true } | { ok: false; error: string };

/**
 * The replay equivalent of the live atomic protection command. Previewing the
 * transition before journal append ensures rejected edits never become replay
 * actions and therefore cannot affect deterministic rewinds.
 */
export function replayUpdateProtection(input: ProtectionUpdate): ReplayProtectionCommandResult {
  const position = state.position;
  if (!state.active || !position || position.side === 'flat') {
    return { ok: false, error: 'Protection requires an open replay position.' };
  }
  const preview = applyProtectionUpdate(position, input);
  if (!preview.ok) return preview;
  if (
    preview.position.sl === position.sl
    && preview.position.tp === position.tp
    && preview.position.trailingSl === position.trailingSl
    && preview.position.trailingBest === position.trailingBest
  ) return { ok: true };
  const action = appendAction({ kind: 'protection', ...input });
  if (!action) return { ok: false, error: 'Replay protection changes require the current replay execution context.' };
  markExecutionStarted();
  set(applyAction(state, action));
  return { ok: true };
}

/** Compatibility adapter for a one-field chart overlay edit. */
export function replaySetOverlay(field: 'tp' | 'sl', value: number | null): ReplayProtectionCommandResult {
  return replayUpdateProtection({ [field]: value });
}

export type ReplayPartialCloseCommandResult = { ok: true } | { ok: false; error: string };

/** Close an accepted fraction of the replay position with a deterministic fill quantity. */
export function replayPartialClose(fraction: number, mark: number, ts: number): ReplayPartialCloseCommandResult {
  const position = state.position;
  if (!state.active || !position || position.side === 'flat' || position.units <= 0) {
    return { ok: false, error: 'Partial close requires an open replay position.' };
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || !Number.isFinite(mark) || mark <= 0 || !Number.isFinite(ts)) {
    return { ok: false, error: 'Partial close requires a positive fraction and market price.' };
  }
  const units = position.units * Math.min(1, fraction);
  if (!(units > 0)) return { ok: false, error: 'Partial close quantity must be positive.' };
  const action = appendAction({ kind: 'partial-close', units, mark, ts });
  if (!action) return { ok: false, error: 'Replay partial close requires the current replay execution context.' };
  markExecutionStarted();
  set(applyAction(state, action));
  return { ok: true };
}

export function replayClose(mark: number, ts: number): { ok: boolean; error?: string } {
  const position = state.position;
  if (!position || position.side === 'flat' || position.units <= 0) return { ok: false, error: 'No active replay position to close' };
  const action = appendAction({ kind: 'close', mark, ts });
  if (!action) return { ok: false, error: 'Replay close requires the current replay execution context.' };
  markExecutionStarted();
  set(applyAction(state, action));
  return { ok: true };
}

/** Incremental forward-only execution against one newly revealed bar. */
export function replayReconcileBar(bar: Candle) {
  const next = reconcileSession(state, bar);
  if (next !== state) set(next);
}

/**
 * Deterministically rebuild the isolated replay account at an earlier cut.
 * Actions after the target are discarded before rebuilding; this makes a new
 * user action at the cut a fresh branch. Exactly one store publish occurs.
 */
export function rebuildReplaySessionAt(targetIndex: number): boolean {
  if (!journal || !state.active) return false;
  const dataset = getReplayDataset();
  if (!dataset.active || dataset.symbol !== state.symbol || dataset.executionTf !== journal.executionTf) return false;
  const candles = dataset.candlesByTf[journal.executionTf];
  if (!candles || candles.length < 2) return false;
  const target = Math.max(journal.startIndex, Math.min(candles.length - 1, Math.floor(targetIndex)));
  journal.actions = journal.actions.filter((action) => action.barIndex <= target);
  journal.nextSequence = journal.actions.length + 1;
  journal.context = { barIndex: target, cutTime: candles[target].time };

  const byIndex = new Map<number, ReplayAction[]>();
  for (const action of journal.actions) {
    const actions = byIndex.get(action.barIndex) ?? [];
    actions.push(action);
    byIndex.set(action.barIndex, actions);
  }
  let rebuilt = cloneState(journal.baseline);
  const applyAt = (index: number) => {
    for (const action of byIndex.get(index) ?? []) rebuilt = applyAction(rebuilt, action);
  };
  // Actions at the start cut were accepted after that candle was already
  // consumed, so they are armed before the first subsequently revealed bar.
  applyAt(journal.startIndex);
  for (let index = journal.startIndex + 1; index <= target; index++) {
    rebuilt = reconcileSession(rebuilt, candles[index]);
    // An action placed at this cut cannot inspect movement already consumed by
    // this candle; it applies only after reconciliation.
    applyAt(index);
  }
  set(rebuilt);
  return true;
}

export function useReplaySession(): ReplaySessionState {
  return useSyncExternalStore(subscribeReplaySession, () => state, () => INITIAL);
}

/** Test-only replay journal access. Returned entries are immutable copies. */
export function __getReplayActionJournalForTest(): readonly ReplayAction[] {
  return journal?.actions.map((action) => ({ ...action })) ?? [];
}

/** Test-only singleton access. */
export function getReplaySessionStateForTest(): ReplaySessionState {
  return cloneState(state);
}

/** Test-only singleton reset. */
export function __resetReplaySessionForTest() {
  journal = null;
  lastConfig = DEFAULT_SESSION_CONFIG;
  set(INITIAL);
}