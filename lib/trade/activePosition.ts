// Live active-position view model (the "Active Position" widget). Pure
// derivation from an open PaperPosition + the current mark price — no state,
// no UI. Everything the widget shows is computed here and unit-tested.
//
// Reuses the tested primitives: unrealizedPnl/marginFor (paper) and the
// leverage-aware liquidationPrice (tradeAnalysis). P&L colour encodes OUTCOME
// direction only; risk/liquidation own their own channels (DESIGN.md F).

import { unrealizedPnl, marginFor, type PaperPosition } from '../paper';
import { liquidationPrice } from '../tradeAnalysis';

export interface ActivePositionView {
  symbol: string;
  side: 'long' | 'short';
  qty: number;                 // units (BTC)
  entry: number;
  mark: number;                // current price
  leverage: number;

  pnlUsd: number;              // live unrealized P&L
  pnlPct: number;              // return on margin (ROE), %
  /** P&L in R-multiples (pnl / initial risk). null when no stop is set. */
  pnlR: number | null;

  marginUsed: number;          // "Amount Used"
  notional: number;            // position value = qty * entry

  stopLoss: number | null;
  takeProfit: number | null;
  /** Loss in USD if the stop is hit (negative). null when no stop. */
  riskUsd: number | null;
  /** Profit in USD if the target is hit (positive). null when no target. */
  rewardUsd: number | null;
  /** Reward:risk ratio (reward / risk). null unless both TP and SL are set. */
  rr: number | null;

  liqPrice: number;
  /** Distance from mark to liquidation, % (always positive). */
  liqDistancePct: number;

  openedAt: number;            // unix seconds
  heldMs: number;              // now - openedAt

  protected: boolean;          // an SL is active
  trailing: boolean;           // trailing stop engaged
}

/**
 * @param pos  the open paper position (side !== 'flat', units > 0)
 * @param mark current mark/last price
 * @param nowMs wall-clock for trade-time (injectable for tests)
 */
export function deriveActivePosition(
  pos: PaperPosition,
  mark: number,
  nowMs: number = Date.now(),
): ActivePositionView | null {
  if (!pos || pos.side === 'flat' || !(pos.units > 0) || !(mark > 0)) return null;

  const side = pos.side;
  const entry = pos.entryPrice;
  const qty = pos.units;
  const dir = side === 'long' ? 1 : -1;

  const pnlUsd = unrealizedPnl(pos, mark);
  const marginUsed = marginFor(qty, entry, pos.leverage);
  const notional = qty * entry;
  const pnlPct = marginUsed > 0 ? (pnlUsd / marginUsed) * 100 : 0;

  const riskUsd = pos.sl != null ? -Math.abs(entry - pos.sl) * qty : null;      // negative
  const rewardUsd = pos.tp != null ? Math.abs(pos.tp - entry) * qty : null;      // positive
  const pnlR = riskUsd != null && riskUsd !== 0 ? pnlUsd / Math.abs(riskUsd) : null;
  const rr = riskUsd != null && rewardUsd != null && riskUsd !== 0
    ? rewardUsd / Math.abs(riskUsd)
    : null;

  const liqPrice = liquidationPrice(entry, pos.leverage, side);
  const liqDistancePct = mark > 0 && Number.isFinite(liqPrice)
    ? (Math.abs(mark - liqPrice) / mark) * 100
    : 0;

  void dir; // side handled inside the primitives
  return {
    symbol: pos.symbol,
    side,
    qty,
    entry,
    mark,
    leverage: pos.leverage,
    pnlUsd,
    pnlPct,
    pnlR,
    marginUsed,
    notional,
    stopLoss: pos.sl,
    takeProfit: pos.tp,
    riskUsd,
    rewardUsd,
    rr,
    liqPrice,
    liqDistancePct,
    openedAt: pos.openedAt,
    heldMs: Math.max(0, nowMs - pos.openedAt * 1000),
    protected: pos.sl != null,
    trailing: pos.trailingSl,
  };
}

/** "18 min" / "2h 4m" / "3d 1h" style compact hold time. */
export function formatHeld(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
