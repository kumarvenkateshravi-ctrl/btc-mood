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

// ----- Store state (in-memory; resets on reload, by design) -----------

interface State {
  /** Positions keyed by symbol (e.g. "BTCUSDT" → PaperPosition). */
  positions: Record<string, PaperPosition | null>;
  pending: PaperOrder[];
  trades: PaperTrade[];
  lastError: string | null;
  lastFill: PaperFill | null;
  toast: { id: number; message: string; tone: 'buy' | 'sell' | 'info' } | null;
  activeOrder: ActiveOrder | null;
  balance: number;
  initialBalance: number;
}

export interface ActiveOrder {
  id: string;
  symbol: string;
  side: Side;
  type: PaperOrder['type'];
  units: number;
  entry: number;
  tp: number | null;
  sl: number | null;
  reduceOnly: boolean;
  postOnly: boolean;
  ocoGroup: string | null;
}

const initialState: State = {
  positions: {},
  pending: [],
  trades: [],
  lastError: null,
  lastFill: null,
  toast: null,
  activeOrder: null,
  balance: INITIAL_PAPER_BALANCE,
  initialBalance: INITIAL_PAPER_BALANCE,
};

let state: State = initialState;
const listeners = new Set<() => void>();
let toastSeq = 0;
let emitting = false;
let pendingEmit = false;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = (): State => state;

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

// ----- Active-order (staged) actions ----------------------------------

export function setActiveOrder(order: ActiveOrder | null) {
  patch((s) => ({ ...s, activeOrder: order, lastError: null }));
}

export function updateActiveOverlay(
  field: 'entry' | 'tp' | 'sl',
  value: number | null,
) {
  patch((s) => {
    if (!s.activeOrder) return s;
    if (field === 'tp' || field === 'sl') {
      return { ...s, activeOrder: { ...s.activeOrder, [field]: value } };
    }
    return { ...s, activeOrder: { ...s.activeOrder, entry: value ?? s.activeOrder.entry } };
  });
}

export function clearActiveOrder() {
  patch((s) => ({ ...s, activeOrder: null }));
}

export function confirmActiveOrder(opts: {
  leverage: number;
  midPrice: number;
}): { ok: boolean; error?: string } {
  const a = state.activeOrder;
  if (!a) return { ok: false, error: 'No active order to confirm.' };
  const res = placeOrder({
    symbol: a.symbol,
    side: a.side,
    type: a.type,
    units: a.units,
    price: a.type === 'market' ? null : a.entry,
    tp: a.tp,
    sl: a.sl,
    reduceOnly: a.reduceOnly,
    postOnly: a.postOnly,
    leverage: opts.leverage,
    midPrice: opts.midPrice,
    ocoGroup: a.ocoGroup,
  });
  if (res.ok) {
    patch((s) => ({ ...s, activeOrder: null }));
  }
  return res;
}

export function setPositionOverlay(
  field: 'tp' | 'sl',
  value: number | null,
  symbol?: string,
) {
  const sym = symbol ?? state.activeOrder?.symbol ?? 'BTCUSDT';
  patch((s) => {
    const pos = posFor(s, sym);
    if (!pos || pos.side === 'flat') return s;
    return setPos(s, sym, { ...pos, [field]: value });
  });
}

export function toggleActiveOverlay(
  field: 'tp' | 'sl',
  enabled: boolean,
  suggested: number,
) {
  patch((s) => {
    if (!s.activeOrder) return s;
    const cur = s.activeOrder[field];
    return {
      ...s,
      activeOrder: {
        ...s.activeOrder,
        [field]: enabled ? (cur ?? suggested) : null,
      },
    };
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
    pushToast(
      `Filled ${input.side.toUpperCase()} ${input.units} @ ${fillPrice.toFixed(1)}`,
      input.side,
    );
    return { ok: true };
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
  let cancelIds = new Set([id]);
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
    activeOrder: null,
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
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => ({
      positions: s.positions,
      pending: s.pending,
      trades: s.trades,
      lastError: s.lastError,
      lastFill: s.lastFill,
      toast: s.toast,
      activeOrder: s.activeOrder,
      balance: s.balance,
      initialBalance: s.initialBalance,
      // Convenience: the position for the active order's symbol when
      // there's no active order; falls back to BTCUSDT.
      position: s.activeOrder ? posFor(s, s.activeOrder.symbol) : posFor(s, 'BTCUSDT'),
      setActiveOrder,
      updateActiveOverlay,
      clearActiveOrder,
      confirmActiveOrder,
      setPositionOverlay,
      toggleActiveOverlay,
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
      s.activeOrder,
      s.balance,
      s.initialBalance,
    ],
  );
}

export function useMarginFor(units: number, price: number, leverage: number) {
  return useCallback(() => marginFor(units, price, leverage), [units, price, leverage]);
}
