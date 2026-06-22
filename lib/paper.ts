// Paper-trading engine. Pure functions, no I/O. The store wraps these
// and feeds them live bars from the dashboard's Binance stream.

import type { Candle } from './types';

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type PositionSide = 'long' | 'short' | 'flat';

export interface PaperOrder {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  units: number;
  /** LMT/STP price; ignored for market. */
  price: number | null;
  /** Take-profit price; null = off. */
  tp: number | null;
  /** Stop-loss price; null = off. */
  sl: number | null;
  reduceOnly: boolean;
  postOnly: boolean;
  createdAt: number;
  /** Leverage for margin calculation when this order fills. */
  leverage: number;
  /** When set, cancelling or filling this order also cancels all
   *  other orders with the same ocoGroup. */
  ocoGroup: string | null;
}

export interface PaperFill {
  orderId: string;
  side: Side;
  units: number;
  price: number;
  feeRate: number;
  fee: number;
  ts: number;
  leverage: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: PositionSide;
  units: number;
  entryPrice: number;
  realizedPnl: number;
  feesPaid: number;
  openedAt: number;
  /** Pending TP / SL attached to the position. */
  tp: number | null;
  sl: number | null;
  /** True if the position was force-closed by the liquidation rule. */
  liquidated: boolean;
  /** Leverage used when this position was opened; needed for margin math. */
  leverage: number;
  /** When true, the SL trails as price moves favorably. */
  trailingSl: boolean;
  /** Best price seen since trailing was enabled (high for long, low for short). */
  trailingBest: number | null;
}

export interface PaperTrade {
  id: string;
  positionId: string;
  side: Side;
  units: number;
  price: number;
  fee: number;
  realizedPnl: number;
  ts: number;
  /** Direction of the closed position (for the trade history). */
  direction?: PositionSide;
  /** Average entry price of the closed position. */
  entryPrice?: number;
  /** Exit fill price (mirror of `price`). */
  exitPrice?: number;
  /** When the closed position was opened (unix seconds). */
  entryTs?: number;
}

// ---- Defaults (Binance USDT-M futures BTCUSDT, paper) ---------------
export const MAKER_FEE = 0.0002; // 0.02%
export const TAKER_FEE = 0.0004; // 0.04%
export const BTC_TICK_VALUE_USD = 0.1; // Binance perps spec, informational
export const BTC_TICK_SIZE = 0.1; // 0.1 USD
export const SLIPPAGE_TICKS = 1; // paper slippage in ticks
export const LIQUIDATION_MARGIN_RATIO = 0.9; // 90% margin loss
export const INITIAL_PAPER_BALANCE = 10_000; // starting paper USD

export function marginFor(units: number, price: number, leverage: number): number {
  if (leverage <= 0) return Infinity;
  return (units * price) / leverage;
}

export function notionalFor(units: number, price: number): number {
  return units * price;
}

/**
 * Apply a fill to the running position. Returns the updated position
 * and the realized P&L delta from any size reduction. Increase-only
 * orders update the average entry on the same side; reversals flatten
 * the old side and open a new one.
 */
export function applyFill(
  pos: PaperPosition | null,
  fill: PaperFill,
  symbol: string,
  now: number,
  leverage = 10,
): { position: PaperPosition; realizedPnl: number; trade: PaperTrade | null } {
  const incomingSide: PositionSide = fill.side === 'buy' ? 'long' : 'short';

  if (pos == null || pos.side === 'flat') {
    const position: PaperPosition = {
      id: fill.orderId,
      symbol,
      side: incomingSide,
      units: fill.units,
      entryPrice: fill.price,
      realizedPnl: -fill.fee,
      feesPaid: fill.fee,
      openedAt: now,
      tp: null,
      sl: null,
      liquidated: false,
      leverage,
      trailingSl: false,
      trailingBest: null,
    };
    return { position, realizedPnl: -fill.fee, trade: null };
  }

  if (incomingSide === pos.side) {
    // Increase on the same side: weighted-average entry.
    const totalUnits = pos.units + fill.units;
    const avg = (pos.units * pos.entryPrice + fill.units * fill.price) / totalUnits;
    const position: PaperPosition = {
      ...pos,
      units: totalUnits,
      entryPrice: avg,
      feesPaid: pos.feesPaid + fill.fee,
      realizedPnl: pos.realizedPnl - fill.fee,
    };
    return { position, realizedPnl: -fill.fee, trade: null };
  }

  // Reducing or reversing.
  const closeQty = Math.min(pos.units, fill.units);
  const signedPnlPerUnit =
    pos.side === 'long' ? fill.price - pos.entryPrice : pos.entryPrice - fill.price;
  const closePnl = signedPnlPerUnit * closeQty;
  const feeShare = (fill.fee * closeQty) / fill.units;
  const realizedPnl = pos.realizedPnl + closePnl - feeShare;

  const trade: PaperTrade = {
    id: `t_${fill.orderId}`,
    positionId: pos.id,
    side: fill.side,
    units: closeQty,
    price: fill.price,
    fee: feeShare,
    realizedPnl: closePnl - feeShare,
    ts: fill.ts,
    direction: pos.side,
    entryPrice: pos.entryPrice,
    exitPrice: fill.price,
    entryTs: pos.openedAt,
  };

  const leftover = fill.units - closeQty;
  if (leftover <= 0) {
    const position: PaperPosition = {
      ...pos,
      units: 0,
      side: 'flat',
      realizedPnl,
      feesPaid: pos.feesPaid + feeShare,
    };
    return { position, realizedPnl: closePnl - feeShare, trade };
  }

  // Reversal: flatten + open opposite at fill price.
  const position: PaperPosition = {
    id: fill.orderId,
    symbol,
    side: incomingSide,
    units: leftover,
    entryPrice: fill.price,
    realizedPnl,
    feesPaid: pos.feesPaid + fill.fee,
    openedAt: now,
    tp: pos.tp,
    sl: pos.sl,
    liquidated: false,
    leverage: pos.leverage,
    trailingSl: false, // reset on reversal
    trailingBest: null,
  };
  return { position, realizedPnl: closePnl - feeShare, trade };
}

/**
 * Run one bar of price action against pending working orders and the
 * open position. Returns the resulting position plus any trades that
 * fired this bar. Stops and limits fire intrabar in this order: SL
 * first (worst-case for the trader), then TP, then limit, then stop
 * entry. This is a conservative ordering for paper.
 */
export function reconcile(
  pos: PaperPosition | null,
  bar: Candle,
  pending: PaperOrder[],
  now: number,
): { position: PaperPosition | null; trades: PaperTrade[]; filled: PaperOrder[] } {
  let position = pos;
  const trades: PaperTrade[] = [];
  const filled: PaperOrder[] = [];

  // 0. Trailing SL: move the SL in the trader's favor as price improves.
  if (position && position.side !== 'flat' && position.sl != null && position.trailingSl) {
    const entry = position.entryPrice;
    const trailDist = position.side === 'long'
      ? entry - position.sl       // distance SL trails behind entry
      : position.sl - entry;      // distance SL trails above entry (short)
    const best = position.trailingBest ?? entry;
    if (position.side === 'long') {
      const newBest = Math.max(best, bar.high);
      if (newBest > best) {
        const newSl = Number((newBest - trailDist).toFixed(1));
        if (newSl > position.sl) {
          position = { ...position, trailingBest: newBest, sl: newSl };
        }
      }
    } else {
      const newBest = Math.min(best, bar.low);
      if (newBest < best) {
        const newSl = Number((newBest + trailDist).toFixed(1));
        if (newSl < position.sl) {
          position = { ...position, trailingBest: newBest, sl: newSl };
        }
      }
    }
  }

  // 1. SL on the open position (intrabar — assume worst case for trader).
  if (position && position.side !== 'flat' && position.sl != null) {
    const slHit =
      position.side === 'long' ? bar.low <= position.sl : bar.low >= position.sl;
    if (slHit) {
      const fillPrice = position.sl;
      const fill: PaperFill = {
        orderId: `sl_${position.id}_${bar.time}`,
        side: position.side === 'long' ? 'sell' : 'buy',
        units: position.units,
        price: fillPrice,
        feeRate: TAKER_FEE,
        fee: position.units * fillPrice * TAKER_FEE,
        ts: bar.time,
        leverage: position.leverage,
      };
      const out = applyFill(position, fill, position.symbol, now, position.leverage);
      position = out.position;
      if (out.trade) trades.push(out.trade);
    }
  }

  // 2. TP on the open position.
  if (position && position.side !== 'flat' && position.tp != null) {
    const tpHit =
      position.side === 'long' ? bar.high >= position.tp : bar.high <= position.tp;
    if (tpHit) {
      const fillPrice = position.tp;
      const fill: PaperFill = {
        orderId: `tp_${position.id}_${bar.time}`,
        side: position.side === 'long' ? 'sell' : 'buy',
        units: position.units,
        price: fillPrice,
        feeRate: TAKER_FEE,
        fee: position.units * fillPrice * TAKER_FEE,
        ts: bar.time,
        leverage: position.leverage,
      };
      const out = applyFill(position, fill, position.symbol, now, position.leverage);
      position = out.position;
      if (out.trade) trades.push(out.trade);
    }
  }

  // 3. Liquidation check.
  if (position && position.side !== 'flat' && position.units > 0) {
    const entry = position.entryPrice;
    const worst = position.side === 'long' ? bar.low : bar.high;
    const dir = position.side === 'long' ? -1 : 1;
    const lossPct = ((worst - entry) / entry) * dir;
    if (lossPct >= LIQUIDATION_MARGIN_RATIO) {
      const fillPrice = worst;
      const fill: PaperFill = {
        orderId: `liq_${position.id}_${bar.time}`,
        side: position.side === 'long' ? 'sell' : 'buy',
        units: position.units,
        price: fillPrice,
        feeRate: TAKER_FEE,
        fee: position.units * fillPrice * TAKER_FEE,
        ts: bar.time,
        leverage: position.leverage,
      };
      const out = applyFill(position, fill, position.symbol, now, position.leverage);
      position = { ...out.position, liquidated: true };
      if (out.trade) trades.push(out.trade);
    }
  }

  // 4. Working orders (limit then stop).
  for (const order of pending) {
    if (filled.find((f) => f.id === order.id)) continue;
    const lev = order.leverage ?? 10;
    if (order.type === 'limit' && order.price != null) {
      const triggered =
        order.side === 'buy' ? bar.low <= order.price : bar.high >= order.price;
      if (triggered) {
        const feeRate = order.postOnly ? MAKER_FEE : TAKER_FEE;
        const fill: PaperFill = {
          orderId: order.id,
          side: order.side,
          units: order.units,
          price: order.price,
          feeRate,
          fee: order.units * order.price * feeRate,
          ts: bar.time,
          leverage: lev,
        };
        const out = applyFill(position, fill, order.symbol, now, lev);
        position = out.position;
        if (out.trade) trades.push(out.trade);
        filled.push(order);
      }
    } else if (order.type === 'stop' && order.price != null) {
      const armed =
        order.side === 'buy' ? bar.high >= order.price : bar.low <= order.price;
      if (armed) {
        // Stop becomes a market order at the stop price (slight slippage).
        const slip = SLIPPAGE_TICKS * BTC_TICK_SIZE;
        const fillPrice = order.side === 'buy' ? order.price + slip : order.price - slip;
        const fill: PaperFill = {
          orderId: order.id,
          side: order.side,
          units: order.units,
          price: fillPrice,
          feeRate: TAKER_FEE,
          fee: order.units * fillPrice * TAKER_FEE,
          ts: bar.time,
          leverage: lev,
        };
        const out = applyFill(position, fill, order.symbol, now, lev);
        position = out.position;
        if (out.trade) trades.push(out.trade);
        filled.push(order);
      }
    }
  }

  // 5. OCO cancellation: when any order in an OCO group fills,
  // cancel all sibling orders (same symbol, same ocoGroup) and
  // release their margin. Only meaningful when ocoGroup is non-null.
  for (const f of filled) {
    const group = pending.find((o) => o.id === f.id)?.ocoGroup;
    if (!group) continue;
    for (const sibling of pending) {
      if (sibling.id === f.id) continue;
      if (sibling.ocoGroup === group && sibling.symbol === f.symbol) {
        filled.push(sibling); // treated as filled for the store to clean up
      }
    }
  }

  return { position, trades, filled };
}

/**
 * Mark-to-market P&L for the open position at the current price.
 * Returns 0 when flat.
 */
export function unrealizedPnl(pos: PaperPosition | null, mark: number): number {
  if (!pos || pos.side === 'flat' || pos.units <= 0) return 0;
  const dir = pos.side === 'long' ? 1 : -1;
  return (mark - pos.entryPrice) * pos.units * dir;
}

/**
 * Validate a candidate order against an open position. Returns a
 * human-readable reason if the order must be rejected, otherwise null.
 */
export function validateOrder(
  order: PaperOrder,
  pos: PaperPosition | null,
  balance: number,
  leverage: number,
): string | null {
  if (order.units <= 0) return 'Units must be greater than zero.';
  if (leverage <= 0) return 'Leverage must be greater than zero.';
  if (order.type !== 'market' && (order.price == null || order.price <= 0)) {
    return 'Price is required for limit and stop orders.';
  }
  if (order.reduceOnly) {
    if (!pos || pos.side === 'flat') {
      return 'Reduce-only requires an open position.';
    }
    const incomingSide: PositionSide = order.side === 'buy' ? 'long' : 'short';
    if (incomingSide === pos.side) {
      return 'Reduce-only cannot increase position size.';
    }
  }
  return null;
}

/**
 * Compute the fill price for a market order at `mid` with one-tick
 * slippage against the trader.
 */
export function marketFillPrice(side: Side, mid: number): number {
  const slip = SLIPPAGE_TICKS * BTC_TICK_SIZE;
  return side === 'buy' ? mid + slip : mid - slip;
}
