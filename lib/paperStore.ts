'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  applyFill,
  marketFillPrice,
  marginFor,
  reconcile,
  TAKER_FEE,
  validateOrder,
  INITIAL_PAPER_BALANCE,
  type PaperFill,
  type PaperOrder,
  type PaperPosition,
  type PaperTrade,
  type Side,
} from './paper';

// ----- Store state (persisted to localStorage; survives reload) -------

interface State {
  /** Positions keyed by symbol (e.g. "BTCUSDT" → PaperPosition). */
  positions: Record<string, PaperPosition | null>;
  pending: PaperOrder[];
  trades: PaperTrade[];
  lastError: string | null;
  lastFill: PaperFill | null;
  toast: { id: number; message: string; tone: 'buy' | 'sell' | 'info' } | null;
  balance: number;
  initialBalance: number;
}

const initialState: State = {
  positions: {},
  pending: [],
  trades: [],
  lastError: null,
  lastFill: null,
  toast: null,
  balance: INITIAL_PAPER_BALANCE,
  initialBalance: INITIAL_PAPER_BALANCE,
};

// ----- Persistence (localStorage) -------------------------------------
// The paper account is a real balance the trader builds over sessions, so
// it must survive a page refresh. Only the durable slice is serialized;
// transient UI (toast/lastError/lastFill) is intentionally left out.

export const PAPER_STORAGE_KEY = 'mcs.paper.v1';

interface PersistedState {
  positions: Record<string, PaperPosition | null>;
  pending: PaperOrder[];
  trades: PaperTrade[];
  balance: number;
  initialBalance: number;
}

function loadPersisted(): State {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = window.localStorage.getItem(PAPER_STORAGE_KEY);
    if (!raw) return initialState;
    const p = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...initialState,
      positions: p.positions ?? {},
      pending: p.pending ?? [],
      trades: p.trades ?? [],
      balance: typeof p.balance === 'number' ? p.balance : INITIAL_PAPER_BALANCE,
      initialBalance:
        typeof p.initialBalance === 'number' ? p.initialBalance : INITIAL_PAPER_BALANCE,
    };
  } catch {
    return initialState; // corrupt/unavailable storage → fresh account
  }
}

function persist(s: State) {
  if (typeof window === 'undefined') return;
  try {
    const data: PersistedState = {
      positions: s.positions,
      pending: s.pending,
      trades: s.trades,
      balance: s.balance,
      initialBalance: s.initialBalance,
    };
    window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota exceeded / private mode — non-fatal, skip the write */
  }
}

// On the client the module reads persisted state at load; on the server it
// stays `initialState` (see getServerSnapshot below), so SSR/hydration match.
let state: State = loadPersisted();
const listeners = new Set<() => void>();
let toastSeq = 0;
let emitting = false;
let pendingEmit = false;
// Live-reconcile cursor: the price we last checked SL/TP against. Live
// reconciliation must only react to movement SINCE this price — never a
// forming candle's accumulated high/low (which includes action from before
// the position opened and, on higher TFs, the whole day's range). Seeded when
// an order is placed so the first post-entry tick can't retroactively fill.
let liveTickCursor: number | null = null;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = (): State => state;
// Server render (and the hydration pass) must see the empty initial account so
// the client HTML matches; useSyncExternalStore then re-renders with the
// persisted client snapshot on the next tick.
const getServerSnapshot = (): State => initialState;

const scheduleEmit = () => {
  if (emitting) {
    pendingEmit = true;
    return;
  }
  emitting = true;
  try {
    do {
      pendingEmit = false;
      const ls = Array.from(listeners);
      for (const l of ls) l();
    } while (pendingEmit);
  } finally {
    emitting = false;
  }
};

const setState = (next: State) => {
  state = next;
  persist(next);
  scheduleEmit();
};

const patch = (mut: (s: State) => State) => setState(mut(state));

/** Look up the position for a symbol (null when flat/missing). */
const posFor = (s: State, sym: string): PaperPosition | null =>
  s.positions[sym] ?? null;

/** Set a position in the map; removes the key when flattened. */
function setPos(s: State, sym: string, pos: PaperPosition): State {
  if (pos.side === 'flat') {
    const copy = { ...s.positions };
    delete copy[sym];
    return { ...s, positions: copy };
  }
  return { ...s, positions: { ...s.positions, [sym]: pos } };
}

// ----- Open-position exit management ----------------------------------

/** Set (or clear, with null) the TP or SL price on a symbol's open position.
 *  The chart overlay commits dragged levels here on Save. */
export function setPositionOverlay(
  field: 'tp' | 'sl',
  value: number | null,
  symbol = 'BTCUSDT',
) {
  patch((s) => {
    const pos = posFor(s, symbol);
    if (!pos || pos.side === 'flat') return s;
    return setPos(s, symbol, { ...pos, [field]: value });
  });
}

/** Toggle trailing SL on/off for a symbol's open position. When
 *  enabled, the SL price is used as the initial trail stop and
 *  `trailingBest` is seeded from the current entry price. */
export function toggleTrailingSl(symbol: string, enabled: boolean) {
  patch((s) => {
    const pos = posFor(s, symbol);
    if (!pos || pos.side === 'flat') return s;
    const next: PaperPosition = {
      ...pos,
      trailingSl: enabled,
      trailingBest: enabled ? (pos.trailingBest ?? pos.entryPrice) : null,
    };
    return setPos(s, symbol, next);
  });
}

const pushToast = (message: string, tone: 'buy' | 'sell' | 'info') => {
  const id = ++toastSeq;
  patch((s) => ({ ...s, toast: { id, message, tone } }));
  setTimeout(() => {
    patch((s) => (s.toast && s.toast.id === id ? { ...s, toast: null } : s));
  }, 2400);
};

export function newOrderId(): string {
  return `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Test-only: reset the singleton state. */
export function __resetForTest() {
  setState({ ...initialState });
}

/** Test-only: read the current state. */
export function __getStateForTest(): State {
  return state;
}

/** Test-only: reload the module state from localStorage (simulates a page
 *  refresh — the module re-reads persisted state at load in the browser). */
export function __rehydrateForTest() {
  setState(loadPersisted());
}

export interface PlaceOrderInput {
  symbol: string;
  side: Side;
  type: PaperOrder['type'];
  units: number;
  price: number | null;
  tp: number | null;
  sl: number | null;
  reduceOnly: boolean;
  postOnly: boolean;
  leverage: number;
  midPrice: number;
  /** When non-null, filling this order cancels all other pending
   *  orders with the same ocoGroup on the same symbol. */
  ocoGroup?: string | null;
  /** Override the fill/open timestamp (unix seconds) — used by Bar Replay so
   *  trades carry the replay bar's time, not wall-clock time. */
  ts?: number;
}

export function placeOrder(input: PlaceOrderInput): { ok: boolean; error?: string } {
  const order: PaperOrder = {
    id: newOrderId(),
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    units: input.units,
    price: input.price,
    tp: input.tp,
    sl: input.sl,
    reduceOnly: input.reduceOnly,
    postOnly: input.postOnly,
    createdAt: Date.now(),
    leverage: input.leverage,
    ocoGroup: input.ocoGroup ?? null,
  };
  const existingPos = posFor(state, input.symbol);
  const err = validateOrder(order, existingPos, state.balance, input.leverage);
  if (err) {
    patch((s) => ({ ...s, lastError: err }));
    return { ok: false, error: err };
  }

  const fillPrice =
    input.type === 'market'
      ? marketFillPrice(input.side, input.midPrice)
      : (input.price ?? 0);
  const needed = order.reduceOnly ? 0 : marginFor(input.units, fillPrice, input.leverage);
  if (needed > 0 && state.balance < needed) {
    const errMsg = `Insufficient balance: need $${needed.toFixed(2)}, have $${state.balance.toFixed(2)}`;
    patch((s) => ({ ...s, lastError: errMsg }));
    return { ok: false, error: errMsg };
  }

  if (input.type === 'market') {
    const fill: PaperFill = {
      orderId: order.id,
      side: input.side,
      units: input.units,
      price: fillPrice,
      feeRate: TAKER_FEE,
      fee: input.units * fillPrice * TAKER_FEE,
      ts: input.ts ?? Math.floor(Date.now() / 1000),
      leverage: input.leverage,
    };
    const out = applyFill(existingPos, fill, input.symbol, fill.ts, input.leverage);
    const trades = out.trade ? [out.trade, ...state.trades].slice(0, 50) : state.trades;
    const nextPos: PaperPosition = { ...out.position, tp: input.tp, sl: input.sl };
    const balanceDelta = out.trade ? out.trade.realizedPnl : -fill.fee;
    setState({
      ...state,
      positions: { ...state.positions, [input.symbol]: nextPos },
      trades,
      lastError: null,
      lastFill: fill,
      balance: state.balance - needed + balanceDelta,
    });
    liveTickCursor = fillPrice; // reset the cursor to the fresh entry
    pushToast(
      `Filled ${input.side.toUpperCase()} ${input.units} @ ${fillPrice.toFixed(1)}`,
      input.side,
    );
    return { ok: true };
  }

  // Limit / stop parked below: seed the cursor from the current price so a
  // pending order is only checked against movement from here on.
  if (liveTickCursor == null && Number.isFinite(input.midPrice) && input.midPrice > 0) {
    liveTickCursor = input.midPrice;
  }

  // Limit / stop: park in pending. Deduct margin now.
  const pending = [order, ...state.pending].slice(0, 20);
  const nextBalance = state.balance - needed;
  const sym = input.symbol;
  const existing = posFor(state, sym);
  if (existing && existing.side !== 'flat') {
    const incomingSide: PaperPosition['side'] = input.side === 'buy' ? 'long' : 'short';
    if (existing.side === incomingSide) {
      patch((s) =>
        setPos(
          { ...s, pending, balance: nextBalance, lastError: null },
          sym,
          { ...existing, tp: input.tp ?? existing.tp, sl: input.sl ?? existing.sl },
        ),
      );
      pushToast(`${input.type.toUpperCase()} ${input.side.toUpperCase()} working`, 'info');
      return { ok: true };
    }
  }
  patch((s) => ({ ...s, balance: nextBalance, pending, lastError: null }));
  pushToast(`${input.type.toUpperCase()} ${input.side.toUpperCase()} working`, 'info');
  return { ok: true };
}

export function cancelOrder(id: string) {
  const order = state.pending.find((o) => o.id === id);
  if (!order) return;
  // OCO: cancel siblings too and refund their margin.
  const cancelIds = new Set([id]);
  let refund = 0;
  const group = order.ocoGroup;
  if (group) {
    for (const o of state.pending) {
      if (o.id !== id && o.ocoGroup === group && o.symbol === order.symbol) {
        cancelIds.add(o.id);
        if (!o.reduceOnly) {
          refund += marginFor(o.units, o.price ?? 0, o.leverage);
        }
      }
    }
  }
  if (!order.reduceOnly) {
    refund += marginFor(order.units, order.price ?? 0, order.leverage);
  }
  setState({
    ...state,
    pending: state.pending.filter((o) => !cancelIds.has(o.id)),
    balance: state.balance + refund,
  });
  pushToast('Order cancelled', 'info');
}

export function closePosition(midPrice: number, symbol?: string) {
  const sym = symbol ?? 'BTCUSDT';
  const pos = posFor(state, sym);
  if (!pos || pos.side === 'flat' || pos.units <= 0) return;
  _closeUnits(pos, sym, pos.units, midPrice);
}

/** Close a fraction (0..1) of the open position. */
export function partialClose(symbol: string, fraction: number, midPrice: number) {
  const pos = posFor(state, symbol);
  if (!pos || pos.side === 'flat' || pos.units <= 0) return;
  const qty = pos.units * Math.min(1, Math.max(0, fraction));
  if (qty <= 0) return;
  _closeUnits(pos, symbol, qty, midPrice);
}

function _closeUnits(
  pos: PaperPosition,
  sym: string,
  units: number,
  midPrice: number,
) {
  const side: Side = pos.side === 'long' ? 'sell' : 'buy';
  const fillPrice = marketFillPrice(side, midPrice);
  const fill: PaperFill = {
    orderId: `close_${pos.id}_${Date.now()}`,
    side,
    units,
    price: fillPrice,
    feeRate: TAKER_FEE,
    fee: units * fillPrice * TAKER_FEE,
    ts: Math.floor(Date.now() / 1000),
    leverage: pos.leverage,
  };
  const out = applyFill(pos, fill, sym, fill.ts, pos.leverage);
  const trades = out.trade ? [out.trade, ...state.trades].slice(0, 50) : state.trades;
  // Release margin proportionally: locked margin * (units closed / total).
  const marginLocked = marginFor(pos.units, pos.entryPrice, pos.leverage);
  const released = marginLocked * (units / pos.units);
  const pnlDelta = out.trade ? out.trade.realizedPnl : 0;
  setState(
    setPos(
      { ...state, trades, lastFill: fill, balance: state.balance + released + pnlDelta },
      sym,
      out.position,
    ),
  );
  pushToast(
    `Closed ${units.toFixed(4)} @ ${fillPrice.toFixed(1)} · P&L ${pnlDelta.toFixed(2)}`,
    'info',
  );
}

export function cancelAll() {
  let refund = 0;
  for (const o of state.pending) {
    if (!o.reduceOnly) {
      const fp = o.price ?? 0;
      refund += marginFor(o.units, fp, o.leverage);
    }
  }
  setState({ ...state, pending: [], balance: state.balance + refund });
  pushToast('All working orders cancelled', 'info');
}

export function resetAll() {
  setState({
    positions: {},
    pending: [],
    trades: [],
    lastError: null,
    lastFill: null,
    toast: null,
    balance: INITIAL_PAPER_BALANCE,
    initialBalance: INITIAL_PAPER_BALANCE,
  });
  pushToast('Paper account reset', 'info');
}

// ----- Quick-action API -------------------------------------------------

export interface ExecuteOrderInput {
  type: 'BUY' | 'SELL';
  size: number;
  orderType: 'MARKET';
  symbol: string;
  midPrice: number;
  leverage: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  /** Override the fill timestamp (unix seconds) — for Bar Replay. */
  ts?: number;
}

export interface ExecuteOrderResult {
  ok: boolean;
  error?: string;
  orderId: string | null;
}

export function executeOrder(input: ExecuteOrderInput): ExecuteOrderResult {
  if (input.orderType !== 'MARKET') {
    return { ok: false, error: 'executeOrder only supports MARKET', orderId: null };
  }
  const result = placeOrder({
    symbol: input.symbol,
    side: input.type === 'BUY' ? 'buy' : 'sell',
    type: 'market',
    units: input.size,
    price: null,
    tp: input.takeProfit ?? null,
    sl: input.stopLoss ?? null,
    reduceOnly: false,
    postOnly: false,
    leverage: input.leverage,
    midPrice: input.midPrice,
    ts: input.ts,
  });
  return {
    ok: result.ok,
    error: result.error,
    orderId: result.ok ? (state.positions[input.symbol]?.id ?? null) : null,
  };
}

export function setStopLoss(_orderId: string | null, price: number | null) {
  setPositionOverlay('sl', price);
}

export function setTakeProfit(_orderId: string | null, price: number | null) {
  setPositionOverlay('tp', price);
}

/** Replay a single new bar against the working book. Iterates every
 *  open position so multi-symbol portfolios stay in sync. (Bar Replay
 *  uses a separate isolated account in lib/replaySession.ts, so this only
 *  ever sees live bars.) */
/**
 * Live reconciliation from a price tick. Builds a minimal bar covering only the
 * movement between the previous tick and this one, so SL/TP and pending orders
 * fill when price ACTUALLY reaches them — not retroactively against a forming
 * candle's range. This fixes freshly-placed positions vanishing instantly
 * because a higher-TF forming candle's low/high already spanned their exits.
 */
export function reconcileLiveTick(price: number, ts: number) {
  if (typeof window === 'undefined' || !Number.isFinite(price) || price <= 0) return;
  const prev = liveTickCursor;
  liveTickCursor = price;
  if (prev == null || prev === price) return; // seed only / no movement
  reconcileBar({
    time: ts,
    open: prev,
    high: Math.max(prev, price),
    low: Math.min(prev, price),
    close: price,
    volume: 0,
  });
}

export function reconcileBar(bar: import('./types').Candle) {
  if (typeof window === 'undefined') return;
  let nextState = state;
  let changed = false;

  // Collect all symbols that have pending orders or open positions.
  const symbols = new Set(Object.keys(nextState.positions));
  for (const o of nextState.pending) symbols.add(o.symbol);
  if (symbols.size === 0) return;

  for (const sym of symbols) {
    const pos = posFor(nextState, sym);
    const orders = nextState.pending.filter((o) => o.symbol === sym);
    if (orders.length === 0 && (!pos || pos.side === 'flat')) continue;

    const r = reconcile(pos, bar, orders, bar.time);
    let nextPos = r.position;
    changed = true;
    if (nextPos && pos) {
      if (nextPos.side === 'flat') {
        nextPos = { ...nextPos, tp: null, sl: null };
      } else {
        // Preserve TP/SL from the old position, but keep the
        // trailing-updated SL if reconcile moved it in the trader's
        // favor (i.e. sl changed compared to pos.sl while position
        // wasn't closed).
        nextPos = {
          ...nextPos,
          tp: nextPos.tp ?? pos.tp,
          sl: nextPos.sl ?? pos.sl,
          trailingSl: pos.trailingSl,
          trailingBest: nextPos.trailingBest ?? pos.trailingBest,
        };
      }
    }
    const filledIds = new Set(r.filled.map((f) => f.id));
    nextState = {
      ...nextState,
      pending: nextState.pending.filter((o) => !filledIds.has(o.id)),
    };
    if (nextPos && nextPos.side !== 'flat') {
      nextState = {
        ...nextState,
        positions: { ...nextState.positions, [sym]: nextPos },
      };
    } else {
      const copy = { ...nextState.positions };
      delete copy[sym];
      nextState = { ...nextState, positions: copy };
    }
    if (r.trades.length > 0) {
      nextState = {
        ...nextState,
        trades: [...r.trades, ...nextState.trades].slice(0, 50),
      };
    }
    // Balance tracking
    let balanceDelta = 0;
    for (const f of r.filled) {
      if (!f.reduceOnly) {
        const fp = f.price ?? 0;
        balanceDelta -= marginFor(f.units, fp, f.leverage);
      }
    }
    for (const t of r.trades) {
      balanceDelta += t.realizedPnl;
    }
    const posWasOpen = pos && pos.side !== 'flat';
    const posNowClosed = !nextPos || nextPos.side === 'flat';
    if (posWasOpen && posNowClosed && pos) {
      balanceDelta += marginFor(pos.units, pos.entryPrice, pos.leverage);
    }
    nextState = { ...nextState, balance: nextState.balance + balanceDelta };
  }

  if (changed) setState(nextState);
}

// ----- React hook surface ---------------------------------------------

export function usePaperStore() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () => ({
      positions: s.positions,
      pending: s.pending,
      trades: s.trades,
      lastError: s.lastError,
      lastFill: s.lastFill,
      toast: s.toast,
      balance: s.balance,
      initialBalance: s.initialBalance,
      // Convenience: the BTCUSDT position (the app trades one symbol on-chart).
      position: posFor(s, 'BTCUSDT'),
      setPositionOverlay,
      placeOrder,
      cancelOrder,
      cancelAll,
      closePosition,
      partialClose,
      toggleTrailingSl,
      resetAll,
    }),
    [
      s.positions,
      s.pending,
      s.trades,
      s.lastError,
      s.lastFill,
      s.toast,
      s.balance,
      s.initialBalance,
    ],
  );
}

export function useMarginFor(units: number, price: number, leverage: number) {
  return useCallback(() => marginFor(units, price, leverage), [units, price, leverage]);
}
