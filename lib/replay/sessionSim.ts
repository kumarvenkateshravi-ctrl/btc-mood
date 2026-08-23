// Trading-session simulator for Bar Replay (spec: replayBar.md) — the pure
// layer that turns replay from strategy-watching into practicing the full
// professional workflow: account config, risk-based position sizing, one
// position at a time, live account stats, and an end-of-session report with
// behavioral coaching. All functions are pure; lib/replaySession.ts owns the
// state and the fills.

import type { PaperTrade } from '../paper';
import { sizeRiskPosition, type RiskSizingResult } from '../riskSizing';

// ---- Session configuration --------------------------------------------------

export const SESSION_CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'INR', symbol: '₹' },
  { code: 'GBP', symbol: '£' },
] as const;
export type SessionCurrencyCode = (typeof SESSION_CURRENCIES)[number]['code'];

/** User rule: leverage is selectable at 1x, 5x, or 10x — nothing else. */
export const SESSION_LEVERAGES = [1, 5, 10] as const;
export type SessionLeverage = (typeof SESSION_LEVERAGES)[number];

export const SESSION_RISK_PRESETS = [0.5, 1, 2] as const;

export interface SessionConfig {
  currency: SessionCurrencyCode;
  startBalance: number;
  /** Commission per fill as a fraction (0.0005 = 0.05%). */
  commissionRate: number;
  leverage: SessionLeverage;
  /** Risk per trade as a percent of balance (0.5 | 1 | 2 | custom). */
  riskPct: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  currency: 'USD',
  startBalance: 1000,
  commissionRate: 0.0005,
  leverage: 1,
  riskPct: 1,
};

export function currencySymbol(code: SessionCurrencyCode): string {
  return SESSION_CURRENCIES.find((c) => c.code === code)?.symbol ?? '$';
}

// ---- Position sizing (spec step 4: how professionals size) -----------------

/** Compatibility name for the shared risk-sizing result used by replay. */
export type SizingResult = RiskSizingResult;

/**
 * riskAmount / |entry − stop| = units. Guardrails: a stop is required
 * (undefined-risk trades are not allowed), the stop must be on the loss side
 * of the entry, and the required margin must fit the balance at the chosen
 * leverage (capital reservation).
 */
export function positionSizeFor(
  cfg: SessionConfig,
  balance: number,
  side: 'buy' | 'sell',
  entry: number,
  stop: number | null,
): SizingResult {
  return sizeRiskPosition({
    side,
    entryPrice: entry,
    stopPrice: stop,
    equity: balance,
    riskPct: cfg.riskPct,
    leverage: cfg.leverage,
  });
}

// ---- Behavioral tracking (spec step 14) -------------------------------------

export interface TradeBehavior {
  /** Position id the record belongs to. */
  positionId: string;
  /** Times the stop was moved while the position was open. */
  slMoves: number;
  /** Risk planned at entry (currency). */
  plannedRisk: number;
  /** TP at entry (null = none). */
  plannedTp: number | null;
  entryPrice: number;
  side: 'long' | 'short';
  /** Most favorable price reached while open. */
  maxFavorablePrice: number;
  /** 'tp' | 'sl' | 'manual' — how the trade ended. */
  exitKind?: 'tp' | 'sl' | 'manual';
  exitPrice?: number;
  realizedPnl?: number;
}

/** Fraction of the way to TP the trade reached before a manual close. */
export function tpProgress(b: TradeBehavior): number | null {
  if (b.plannedTp == null || b.exitPrice == null) return null;
  const full = Math.abs(b.plannedTp - b.entryPrice);
  if (full <= 0) return null;
  const gained = b.side === 'long' ? b.exitPrice - b.entryPrice : b.entryPrice - b.exitPrice;
  return Math.max(0, Math.min(1, gained / full));
}

export interface CoachingNote {
  tone: 'good' | 'warn';
  text: string;
}

/** The post-session psychology read: process feedback, not P&L feedback. */
export function coachingNotes(behaviors: TradeBehavior[]): CoachingNote[] {
  const done = behaviors.filter((b) => b.exitKind != null);
  if (done.length === 0) return [];
  const notes: CoachingNote[] = [];

  const totalSlMoves = done.reduce((a, b) => a + b.slMoves, 0);
  if (totalSlMoves > 0) {
    const widenedLosses = done.filter(
      (b) => b.slMoves > 0 && (b.realizedPnl ?? 0) < 0 && Math.abs(b.realizedPnl ?? 0) > b.plannedRisk * 1.1,
    ).length;
    notes.push({
      tone: 'warn',
      text:
        `You moved your Stop Loss ${totalSlMoves} time${totalSlMoves === 1 ? '' : 's'}.` +
        (widenedLosses > 0 ? ` ${widenedLosses} loss${widenedLosses === 1 ? '' : 'es'} ended bigger than planned.` : ''),
    });
  }

  const earlyExits = done
    .map((b) => (b.exitKind === 'manual' && (b.realizedPnl ?? 0) > 0 ? tpProgress(b) : null))
    .filter((x): x is number => x != null);
  if (earlyExits.length >= 2) {
    const avg = earlyExits.reduce((a, x) => a + x, 0) / earlyExits.length;
    if (avg < 0.6) {
      notes.push({
        tone: 'warn',
        text: `You exited winners early — on average at ${(avg * 100).toFixed(0)}% of the way to your target.`,
      });
    }
  }

  const losses = done.filter((b) => (b.realizedPnl ?? 0) < 0);
  const respected = losses.every((b) => Math.abs(b.realizedPnl ?? 0) <= b.plannedRisk * 1.1);
  if (losses.length > 0 && respected && totalSlMoves === 0) {
    notes.push({ tone: 'good', text: 'You respected your planned risk on every trade. Excellent discipline.' });
  }

  return notes;
}

// ---- Account statistics (spec steps 12 + 13) --------------------------------

export interface SessionStats {
  balance: number;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  avgRR: number | null;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  /** Max drawdown as % of peak equity along the closed-trade sequence. */
  maxDrawdownPct: number;
  /** Average holding time in seconds (entryTs → exit ts). */
  avgHoldSec: number | null;
}

export function sessionStats(trades: PaperTrade[], startBalance: number): SessionStats {
  // Trades arrive newest-first from the store; walk oldest-first for equity.
  const seq = [...trades].reverse();
  let equity = startBalance;
  let peak = startBalance;
  let maxDdPct = 0;
  let grossWin = 0;
  let grossLoss = 0;
  const rrs: number[] = [];
  const holds: number[] = [];
  let wins = 0;
  let largestWin = 0;
  let largestLoss = 0;

  for (const t of seq) {
    equity += t.realizedPnl;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - equity) / peak) * 100);
    if (t.realizedPnl > 0) {
      wins++;
      grossWin += t.realizedPnl;
      largestWin = Math.max(largestWin, t.realizedPnl);
    } else if (t.realizedPnl < 0) {
      grossLoss += Math.abs(t.realizedPnl);
      largestLoss = Math.min(largestLoss, t.realizedPnl);
    }
    if (t.entryPrice != null && t.exitPrice != null && t.sl != null && t.entryPrice !== t.sl) {
      rrs.push(Math.abs(t.exitPrice - t.entryPrice) / Math.abs(t.entryPrice - t.sl) * Math.sign(t.realizedPnl || 1));
    }
    if (t.entryTs != null) holds.push(Math.max(0, t.ts - t.entryTs));
  }

  const n = seq.length;
  return {
    balance: equity,
    netPnl: equity - startBalance,
    trades: n,
    wins,
    losses: seq.filter((t) => t.realizedPnl < 0).length,
    winRate: n > 0 ? wins / n : 0,
    avgRR: rrs.length > 0 ? rrs.reduce((a, x) => a + x, 0) / rrs.length : null,
    largestWin,
    largestLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDdPct,
    avgHoldSec: holds.length > 0 ? holds.reduce((a, x) => a + x, 0) / holds.length : null,
  };
}
