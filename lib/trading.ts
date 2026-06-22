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
