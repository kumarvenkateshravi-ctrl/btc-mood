// Replay Training Report (Phase 4) — turns a finished replay session into a
// deliberate-practice score card: not AI, not complicated, just the numbers
// a trader needs to grade the session honestly.

import type { PaperTrade } from '../paper';

export interface TrainingReport {
  trades: number;
  wins: number;
  losses: number;
  /** 0–100. */
  winRate: number;
  totalPnl: number;
  avgWin: number;
  /** Positive magnitude. */
  avgLoss: number;
  /** avgWin / avgLoss; null without both wins and losses. */
  payoffRatio: number | null;
  /** Peak-to-trough of the realized equity curve (positive $). */
  maxDrawdown: number;
  bestTrade: number;
  worstTrade: number;
  durationBars: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  gradeNote: string;
}

export function buildTrainingReport(trades: PaperTrade[], durationBars: number): TrainingReport {
  // Session stores newest-first; the equity curve needs chronology.
  const chrono = [...trades].reverse();
  const pnls = chrono.map((t) => t.realizedPnl);

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const totalPnl = pnls.reduce((s, p) => s + p, 0);
  const winRate = pnls.length === 0 ? 0 : Math.round((wins.length / pnls.length) * 100);
  const avgWin = wins.length ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : 0;
  const payoffRatio = wins.length && losses.length && avgLoss > 0 ? avgWin / avgLoss : null;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  // Composite grade: consistency (win rate), asymmetry (payoff), outcome.
  const payoffScore = payoffRatio == null ? (wins.length ? 100 : 0) : (Math.min(payoffRatio, 3) / 3) * 100;
  const composite = 0.45 * winRate + 0.35 * payoffScore + 0.2 * (totalPnl > 0 ? 100 : 0);
  const grade: TrainingReport['grade'] =
    pnls.length === 0 ? 'F' : composite >= 80 ? 'A' : composite >= 65 ? 'B' : composite >= 50 ? 'C' : composite >= 35 ? 'D' : 'F';

  let gradeNote: string;
  if (pnls.length === 0) gradeNote = 'No trades taken — watch, then commit to a setup next session.';
  else if (grade === 'A') gradeNote = 'Consistent and asymmetric. Keep the process identical.';
  else if (winRate < 40) gradeNote = 'Low win rate — wait for the full setup before entering.';
  else if (payoffRatio != null && payoffRatio < 1) gradeNote = 'Winners smaller than losers — let profits run to the liquidity target.';
  else if (totalPnl <= 0) gradeNote = 'Process is close — tighten the invalidation and cut losers sooner.';
  else gradeNote = 'Profitable session. Review the worst trade before the next drill.';

  return {
    trades: pnls.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalPnl,
    avgWin,
    avgLoss,
    payoffRatio,
    maxDrawdown,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    durationBars: Math.max(0, durationBars),
    grade,
    gradeNote,
  };
}
