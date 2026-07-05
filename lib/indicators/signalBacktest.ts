// lib/indicators/signalBacktest.ts
import type { SdSignal } from './signalTypes';

type Tier = SdSignal['tier'];

export interface BacktestSlice {
  trades: number;
  winRate: number;
  avgR: number;
}

export interface BacktestReport {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;   // R per trade (== avgR)
  profitFactor: number;
  maxDrawdownR: number;
  avgBarsInTrade: number;
  byTier: Record<Tier, BacktestSlice>;
  byTf: Record<string, BacktestSlice>;
}

const RESOLVED = new Set<SdSignal['status']>(['tp1', 'tp2', 'stopped']);

/** Realized R for a resolved signal, risk = |entry-stopLoss|. */
function signalR(s: SdSignal): number {
  const risk = Math.abs(s.entry - s.stopLoss);
  if (risk <= 0) return 0;
  const exit = s.status === 'tp2' ? s.takeProfit2 : s.status === 'tp1' ? s.takeProfit1 : s.stopLoss;
  const raw = s.side === 'buy' ? exit - s.entry : s.entry - exit;
  return raw / risk;
}

function slice(rs: number[]): BacktestSlice {
  const trades = rs.length;
  const wins = rs.filter((r) => r > 0).length;
  return { trades, winRate: trades ? wins / trades : 0, avgR: trades ? rs.reduce((s, r) => s + r, 0) / trades : 0 };
}

export function backtestSignals(signals: SdSignal[]): BacktestReport {
  const resolved = signals
    .filter((s) => RESOLVED.has(s.status) && s.triggeredIndex != null && s.resolvedIndex != null)
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

  const rs = resolved.map(signalR);
  const wins = rs.filter((r) => r > 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));

  let peak = 0, equity = 0, maxDd = 0;
  for (const r of rs) { equity += r; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity); }

  const bars = resolved.map((s) => s.resolvedIndex! - s.triggeredIndex!);
  const tiers: Tier[] = ['medium', 'strong'];
  const byTier = Object.fromEntries(
    tiers.map((t) => [t, slice(resolved.filter((s) => s.tier === t).map(signalR))]),
  ) as Record<Tier, BacktestSlice>;
  const tfKeys = [...new Set(resolved.map((s) => s.zoneTf))];
  const byTf = Object.fromEntries(
    tfKeys.map((tf) => [tf, slice(resolved.filter((s) => s.zoneTf === tf).map(signalR))]),
  ) as Record<string, BacktestSlice>;

  const trades = rs.length;
  const avgR = trades ? rs.reduce((s, r) => s + r, 0) / trades : 0;
  return {
    trades, wins, losses: trades - wins,
    winRate: trades ? wins / trades : 0,
    avgR, expectancy: avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownR: maxDd,
    avgBarsInTrade: bars.length ? bars.reduce((s, b) => s + b, 0) / bars.length : 0,
    byTier, byTf,
  };
}
