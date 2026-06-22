// Pure trading math for the trading panel: position sizing from risk, and
// reward-to-risk from entry / TP / SL. No state — unit-tested in isolation.

export type TradeSide = 'long' | 'short';

/**
 * Recommended position size (units) so that being stopped out loses exactly
 * `riskPct`% of the account: qty = (balance · risk%) / stop-loss distance.
 * Returns 0 for non-positive / invalid inputs.
 */
export function positionSize(balance: number, riskPct: number, slDistance: number): number {
  if (!(balance > 0) || !(riskPct > 0) || !(slDistance > 0)) return 0;
  return (balance * (riskPct / 100)) / slDistance;
}

/**
 * Reward-to-risk ratio for a trade. Long: reward = tp − entry, risk = entry − sl.
 * Short: reward = entry − tp, risk = sl − entry. Returns null when TP/SL are
 * missing or placed on the wrong side (non-positive reward or risk).
 */
export function riskReward(
  side: TradeSide,
  entry: number,
  tp: number | null,
  sl: number | null,
): number | null {
  if (tp == null || sl == null) return null;
  const reward = side === 'long' ? tp - entry : entry - tp;
  const risk = side === 'long' ? entry - sl : sl - entry;
  if (!(reward > 0) || !(risk > 0)) return null;
  return reward / risk;
}

/** Format a ratio as "R:1" (e.g. 2.5 → "2.50 : 1"). */
export function formatRR(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${ratio.toFixed(2)} : 1`;
}

// ---- Closed-trade derivations (shared by the trade history table + CSV) ----

import type { PaperTrade } from './paper';

export type TradeOutcome = 'TP' | 'SL' | 'WIN' | 'LOSS' | 'BE';

export function tradeDirection(t: PaperTrade): TradeSide {
  if (t.direction === 'long' || t.direction === 'short') return t.direction;
  // Closing a long is a 'sell' fill; closing a short is a 'buy' fill.
  return t.side === 'sell' ? 'long' : 'short';
}

export function tradeExit(t: PaperTrade): number {
  return t.exitPrice ?? t.price;
}

/** Realized P&L as a percentage of entry (direction-aware). */
export function tradePnlPct(t: PaperTrade): number | null {
  if (t.entryPrice == null || t.entryPrice === 0) return null;
  const dir = tradeDirection(t) === 'long' ? 1 : -1;
  return ((tradeExit(t) - t.entryPrice) / t.entryPrice) * 100 * dir;
}

/** Planned reward:risk from the entry + TP/SL the position carried. */
export function tradeRR(t: PaperTrade): number | null {
  if (t.entryPrice == null) return null;
  return riskReward(tradeDirection(t), t.entryPrice, t.tp ?? null, t.sl ?? null);
}

/** How the trade closed: hit TP/SL (reconcile fills exactly at the level) else win/loss. */
export function tradeOutcome(t: PaperTrade): TradeOutcome {
  const exit = tradeExit(t);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);
  if (t.tp != null && near(exit, t.tp)) return 'TP';
  if (t.sl != null && near(exit, t.sl)) return 'SL';
  return t.realizedPnl > 0 ? 'WIN' : t.realizedPnl < 0 ? 'LOSS' : 'BE';
}
