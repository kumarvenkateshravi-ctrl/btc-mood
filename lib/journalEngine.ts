// Journal "Learning Engine" — analyzes completed trades into performance,
// setup/timeframe/regime breakdowns, mistake tracking, emotional analytics,
// discipline scoring, goals, a daily calendar, an equity curve and AI-coach
// insights. It does NOT require manual entry: it imports paper trades and, when
// there isn't enough real history, falls back to a deterministic SAMPLE set so
// the page is fully meaningful. Pure + unit-tested.

import type { PaperTrade } from './paper';
import { tradeDirection, tradeRR, tradeOutcome, tradeExit } from './trading';

export type Direction = 'Long' | 'Short';
export type Setup = 'Trend Continuation' | 'Breakout' | 'Pullback' | 'Reversal' | 'Scalping' | 'Swing';
export type Regime = 'Trending' | 'Ranging' | 'Volatile';
export type Outcome = 'Win' | 'Loss' | 'Breakeven';
export type Emotion = 'Calm' | 'Confident' | 'Excited' | 'Fearful' | 'FOMO';
export type Mistake = 'Exited Early' | 'Ignored Volume' | 'Moved Stop Loss' | 'Entered Late' | 'FOMO Trading' | 'Ignored Trend' | 'Over Leveraged' | 'Revenge Trade' | 'Skipped Checklist';

export const TF_OPTS = ['5m', '15m', '30m', '1H', '4H', '1D'] as const;
export const SETUPS: Setup[] = ['Trend Continuation', 'Breakout', 'Pullback', 'Reversal', 'Scalping', 'Swing'];
export const EMOTIONS: Emotion[] = ['Calm', 'Confident', 'Excited', 'Fearful', 'FOMO'];
export const MISTAKES: Mistake[] = ['Exited Early', 'Ignored Volume', 'Moved Stop Loss', 'Entered Late', 'FOMO Trading', 'Ignored Trend', 'Over Leveraged', 'Revenge Trade', 'Skipped Checklist'];

export interface DisciplineChecks { entry: boolean; stop: boolean; takeProfit: boolean; riskOk: boolean; checklist: boolean; noEmotionalExit: boolean; }
export interface JournalEntry {
  id: string; date: number; asset: string; direction: Direction; setup: Setup; timeframe: string; regime: Regime;
  entry: number; exit: number; rr: number; pnl: number; holdingMin: number; outcome: Outcome;
  emotion: Emotion; mistakes: Mistake[]; discipline: number; checks: DisciplineChecks;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const pick = <T,>(arr: readonly T[], r: number) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

// Per-setup base win rate + avg risk:reward, used to make the sample realistic.
const SETUP_PROFILE: Record<Setup, { win: number; rr: number; weight: number }> = {
  'Trend Continuation': { win: 0.78, rr: 2.18, weight: 0.36 },
  Breakout: { win: 0.655, rr: 1.85, weight: 0.22 },
  Pullback: { win: 0.72, rr: 1.92, weight: 0.18 },
  Reversal: { win: 0.515, rr: 0.88, weight: 0.11 },
  Scalping: { win: 0.684, rr: 1.32, weight: 0.08 },
  Swing: { win: 0.70, rr: 2.4, weight: 0.05 },
};
const EMOTION_WEIGHT: [Emotion, number][] = [['Calm', 0.42], ['Confident', 0.25], ['Excited', 0.15], ['Fearful', 0.10], ['FOMO', 0.08]];

function weightedSetup(r: number): Setup {
  let acc = 0;
  for (const s of SETUPS) { acc += SETUP_PROFILE[s].weight; if (r <= acc) return s; }
  return 'Trend Continuation';
}
function weightedEmotion(r: number): Emotion {
  let acc = 0;
  for (const [e, w] of EMOTION_WEIGHT) { acc += w; if (r <= acc) return e; }
  return 'Calm';
}

/** Deterministic sample journal (used when real history is thin). */
export function generateSampleEntries(n = 268, seed = 42, now = Date.now()): JournalEntry[] {
  const rand = lcg(seed);
  const assets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
  const out: JournalEntry[] = [];
  for (let i = 0; i < n; i++) {
    const setup = weightedSetup(rand());
    const prof = SETUP_PROFILE[setup];
    const win = rand() < prof.win;
    const rr = win ? +(prof.rr * (0.7 + rand() * 0.7)).toFixed(2) : -(0.7 + rand() * 0.6);
    const risk = 100 + Math.floor(rand() * 120);
    const pnl = +(rr * risk).toFixed(2);
    const direction: Direction = rand() < 0.7 ? 'Long' : 'Short';
    const tf = pick(TF_OPTS, rand());
    const regime: Regime = pick(['Trending', 'Trending', 'Ranging', 'Volatile'] as Regime[], rand());
    const entryPrice = 60000 + rand() * 8000;
    const exitPrice = +(entryPrice * (1 + (rr * 0.004) * (direction === 'Long' ? 1 : -1))).toFixed(1);
    const emotion = weightedEmotion(rand());
    const mistakes: Mistake[] = [];
    if (!win && rand() < 0.6) mistakes.push(pick(MISTAKES, rand()));
    if (rand() < 0.18) mistakes.push(pick(MISTAKES, rand()));
    const checks: DisciplineChecks = { entry: rand() > 0.05, stop: rand() > 0.05, takeProfit: rand() > 0.1, riskOk: rand() > 0.05, checklist: rand() > 0.05, noEmotionalExit: mistakes.length === 0 ? rand() > 0.1 : rand() > 0.5 };
    const discipline = Math.round((Object.values(checks).filter(Boolean).length / 6) * 100);
    out.push({
      id: `s${i}`, date: now - (n - i) * 8 * 3600_000 - Math.floor(rand() * 6 * 3600_000),
      asset: pick(assets, rand()), direction, setup, timeframe: tf, regime,
      entry: +entryPrice.toFixed(1), exit: exitPrice, rr, pnl, holdingMin: 60 + Math.floor(rand() * 600),
      outcome: win ? 'Win' : 'Loss', emotion, mistakes: [...new Set(mistakes)], discipline, checks,
    });
  }
  return out;
}

/** Map real closed paper trades into journal entries (derive what we can). */
export function mapPaperTrades(trades: PaperTrade[], symbol: string): JournalEntry[] {
  return trades.map((t, i) => {
    const dir = tradeDirection(t);
    const rr = tradeRR(t) ?? (t.realizedPnl >= 0 ? 1 : -1);
    const oc = tradeOutcome(t);
    const followedTpSl = oc === 'TP' || oc === 'SL';
    const checks: DisciplineChecks = { entry: true, stop: t.sl != null, takeProfit: t.tp != null, riskOk: true, checklist: true, noEmotionalExit: followedTpSl };
    return {
      id: t.id ?? `p${i}`, date: (t.ts ?? Math.floor(Date.now() / 1000)) * 1000, asset: symbol,
      direction: dir === 'long' ? 'Long' : 'Short', setup: 'Trend Continuation', timeframe: '1H', regime: 'Trending',
      entry: t.entryPrice ?? t.price, exit: tradeExit(t), rr: +rr.toFixed(2), pnl: +t.realizedPnl.toFixed(2),
      holdingMin: t.entryTs && t.ts ? Math.max(1, Math.round((t.ts - t.entryTs) / 60)) : 60,
      outcome: oc === 'TP' || oc === 'WIN' ? 'Win' : oc === 'BE' ? 'Breakeven' : 'Loss',
      emotion: 'Calm', mistakes: [], discipline: Math.round((Object.values(checks).filter(Boolean).length / 6) * 100), checks,
    };
  });
}

// ---- Analysis ----
export interface Breakdown { label: string; trades: number; winRate: number; netProfit: number; avgRR: number; profitFactor: number; }
export interface Bucket { label: string; trades: number; winRate: number; netProfit: number; avgHoldMin: number; }
export interface GoalRow { label: string; current: string; target: string; progress: number; }
export interface CalendarDay { date: number; pnl: number; trades: number; outcome: 'win' | 'loss' | 'none'; }
export interface JournalAnalysis {
  performance: { total: number; winning: number; losing: number; breakeven: number; winRate: number; netProfit: number; profitFactor: number; expectancy: number; avgRR: number; avgWin: number; avgLoss: number; streak: number; bestSetup: { setup: string; winRate: number } };
  deltas: { trades: number; winRate: number; netProfit: number; profitFactor: number; expectancy: number; avgRR: number };
  bySetup: Breakdown[]; byTimeframe: Bucket[]; byRegime: Breakdown[];
  mistakes: { mistake: Mistake; count: number; cost: number }[];
  emotions: { emotion: Emotion; pct: number; winRate: number }[];
  discipline: { score: number; rating: string; delta: number; lastMonth: number; checks: { label: string; passed: number; total: number; warn: boolean }[] };
  goals: GoalRow[];
  calendar: CalendarDay[];
  equity: { time: number; equity: number; benchmark: number }[];
  insights: string[];
}

interface Summary { trades: number; winRate: number; netProfit: number; profitFactor: number; expectancy: number; avgRR: number; discipline: number; }
function summarize(es: JournalEntry[]): Summary {
  const total = es.length;
  const wins = es.filter((e) => e.outcome === 'Win'), losses = es.filter((e) => e.outcome === 'Loss');
  const gp = wins.reduce((s, e) => s + e.pnl, 0), gl = Math.abs(losses.reduce((s, e) => s + e.pnl, 0));
  const awR = wins.length ? wins.reduce((s, e) => s + e.rr, 0) / wins.length : 0;
  const alR = losses.length ? Math.abs(losses.reduce((s, e) => s + e.rr, 0) / losses.length) : 0;
  return {
    trades: total, winRate: total ? (wins.length / total) * 100 : 0, netProfit: es.reduce((s, e) => s + e.pnl, 0),
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? 99 : 0, expectancy: awR * (wins.length / Math.max(1, total)) - alR * (losses.length / Math.max(1, total)),
    avgRR: total ? es.reduce((s, e) => s + Math.abs(e.rr), 0) / total : 0, discipline: total ? es.reduce((s, e) => s + e.discipline, 0) / total : 0,
  };
}

function breakdown<K extends string>(entries: JournalEntry[], keyFn: (e: JournalEntry) => K, labels: K[]): Breakdown[] {
  return labels.map((label) => {
    const ts = entries.filter((e) => keyFn(e) === label);
    const w = ts.filter((e) => e.outcome === 'Win'), l = ts.filter((e) => e.outcome === 'Loss');
    const gp = w.reduce((s, e) => s + e.pnl, 0), gl = Math.abs(l.reduce((s, e) => s + e.pnl, 0));
    return { label, trades: ts.length, winRate: ts.length ? +((w.length / ts.length) * 100).toFixed(1) : 0, netProfit: +ts.reduce((s, e) => s + e.pnl, 0).toFixed(0), avgRR: ts.length ? +(ts.reduce((s, e) => s + e.rr, 0) / ts.length).toFixed(2) : 0, profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : 0 };
  }).filter((b) => b.trades > 0);
}

export function analyzeJournal(entries: JournalEntry[]): JournalAnalysis {
  const total = entries.length;
  const wins = entries.filter((e) => e.outcome === 'Win'), losses = entries.filter((e) => e.outcome === 'Loss'), be = entries.filter((e) => e.outcome === 'Breakeven');
  const gp = wins.reduce((s, e) => s + e.pnl, 0), gl = Math.abs(losses.reduce((s, e) => s + e.pnl, 0));
  const netProfit = +entries.reduce((s, e) => s + e.pnl, 0).toFixed(2);
  const winRate = total ? +((wins.length / total) * 100).toFixed(1) : 0;
  const avgWinR = wins.length ? wins.reduce((s, e) => s + e.rr, 0) / wins.length : 0;
  const avgLossR = losses.length ? Math.abs(losses.reduce((s, e) => s + e.rr, 0) / losses.length) : 0;
  const expectancy = +(avgWinR * (wins.length / Math.max(1, total)) - avgLossR * (losses.length / Math.max(1, total))).toFixed(2);
  const avgRR = total ? +(entries.reduce((s, e) => s + Math.abs(e.rr), 0) / total).toFixed(2) : 0;

  const sorted = [...entries].sort((a, b) => a.date - b.date);
  let streak = 0; for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].outcome === 'Win') streak++; else break; }

  const bySetup = breakdown(entries, (e) => e.setup, SETUPS);
  const bestSetup = [...bySetup].filter((b) => b.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0] ?? { label: '—', winRate: 0 };

  const byTimeframe: Bucket[] = (TF_OPTS as readonly string[]).map((tf) => {
    const ts = entries.filter((e) => e.timeframe === tf); const w = ts.filter((e) => e.outcome === 'Win');
    return { label: tf, trades: ts.length, winRate: ts.length ? +((w.length / ts.length) * 100).toFixed(1) : 0, netProfit: +ts.reduce((s, e) => s + e.pnl, 0).toFixed(0), avgHoldMin: ts.length ? Math.round(ts.reduce((s, e) => s + e.holdingMin, 0) / ts.length) : 0 };
  }).filter((b) => b.trades > 0);

  const byRegime = breakdown(entries, (e) => e.regime, ['Trending', 'Ranging', 'Volatile'] as Regime[]);

  const mistakes = MISTAKES.map((m) => { const ts = entries.filter((e) => e.mistakes.includes(m)); return { mistake: m, count: ts.length, cost: +ts.reduce((s, e) => s + Math.min(0, e.pnl), 0).toFixed(0) }; }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);

  const emotions = EMOTIONS.map((em) => { const ts = entries.filter((e) => e.emotion === em); const w = ts.filter((e) => e.outcome === 'Win'); return { emotion: em, pct: total ? Math.round((ts.length / total) * 100) : 0, winRate: ts.length ? +((w.length / ts.length) * 100).toFixed(0) : 0 }; });

  // Recent-period stats: cap the threshold so a 90 day sample still passes >= 90%.
  const checkDefs: [keyof DisciplineChecks, string][] = [['entry', 'Followed Entry Plan'], ['stop', 'Followed Stop Loss'], ['takeProfit', 'Followed Take Profit'], ['riskOk', 'Risk Management'], ['checklist', 'Checklist Completed'], ['noEmotionalExit', 'No Emotional Exit']];
  const recent = total > 21 ? sorted.slice(-21) : sorted;
  const rTotal = recent.length || 1;
  const discChecks = checkDefs.map(([k, label]) => { const passed = recent.filter((e) => e.checks[k]).length; return { label, passed, total: rTotal, warn: passed / rTotal < 0.9 }; });
  const dScore = total ? Math.round((entries.reduce((s, e) => s + e.discipline, 0) / total)) : 0;

  // Max drawdown of the running equity (for the drawdown goal).
  let runEq = 25_000, peak = 25_000, maxDd = 0;
  for (const e of sorted) { runEq += e.pnl; peak = Math.max(peak, runEq); if (peak > 0) maxDd = Math.max(maxDd, ((peak - runEq) / peak) * 100); }
  const maxDrawdownPct = +maxDd.toFixed(1);

  const goals: GoalRow[] = [
    { label: 'Monthly Profit Goal', current: `$${Math.round(netProfit).toLocaleString()}`, target: '$10,000', progress: clamp(Math.round((netProfit / 10000) * 100), 0, 200) },
    { label: 'Win Rate Goal (70%)', current: `${winRate}%`, target: '70%', progress: clamp(Math.round((winRate / 70) * 100), 0, 200) },
    { label: 'Max Drawdown Goal (10%)', current: `${maxDrawdownPct}%`, target: '10%', progress: clamp(Math.round((maxDrawdownPct / 10) * 100), 0, 200) },
    { label: 'Discipline Goal (90/100)', current: `${dScore}`, target: '90', progress: clamp(Math.round((dScore / 90) * 100), 0, 200) },
    { label: 'Trade Count Goal (250)', current: `${total}`, target: '250', progress: clamp(Math.round((total / 250) * 100), 0, 200) },
  ];

  // Month-over-month deltas for the performance cards + discipline gauge.
  const maxDate = total ? sorted[sorted.length - 1].date : Date.now();
  const MONTH = 30 * 86_400_000;
  const thisM = summarize(entries.filter((e) => e.date > maxDate - MONTH));
  const lastM = summarize(entries.filter((e) => e.date <= maxDate - MONTH && e.date > maxDate - 2 * MONTH));
  const deltas = {
    trades: thisM.trades - lastM.trades,
    winRate: +(thisM.winRate - lastM.winRate).toFixed(1),
    netProfit: lastM.netProfit !== 0 ? +(((thisM.netProfit - lastM.netProfit) / Math.abs(lastM.netProfit)) * 100).toFixed(1) : 0,
    profitFactor: +(thisM.profitFactor - lastM.profitFactor).toFixed(2),
    expectancy: +(thisM.expectancy - lastM.expectancy).toFixed(2),
    avgRR: +(thisM.avgRR - lastM.avgRR).toFixed(2),
  };
  const discDelta = Math.round(thisM.discipline - lastM.discipline);
  const discLast = Math.round(lastM.discipline);

  // Calendar (per UTC day)
  const dayMap = new Map<number, { pnl: number; trades: number }>();
  for (const e of entries) { const day = Math.floor(e.date / 86_400_000) * 86_400_000; const cur = dayMap.get(day) ?? { pnl: 0, trades: 0 }; cur.pnl += e.pnl; cur.trades++; dayMap.set(day, cur); }
  const calendar: CalendarDay[] = [...dayMap.entries()].map(([date, v]) => ({ date, pnl: +v.pnl.toFixed(0), trades: v.trades, outcome: (v.pnl > 0 ? 'win' : v.pnl < 0 ? 'loss' : 'none') as CalendarDay['outcome'] })).sort((a, b) => a.date - b.date);

  // Equity curve (cumulative pnl) + a modest buy&hold benchmark.
  let eq = 25_000, bench = 25_000;
  const equity = sorted.map((e, i) => { eq += e.pnl; bench *= 1 + (Math.sin(i / 9) * 0.004 + 0.0009); return { time: e.date, equity: +eq.toFixed(2), benchmark: +bench.toFixed(2) }; });

  const insights = buildInsights({ bestSetup, mistakes, byTimeframe, winRate, avgWinHold: wins.length ? Math.round(wins.reduce((s, e) => s + e.holdingMin, 0) / wins.length) : 0 });

  return {
    performance: { total, winning: wins.length, losing: losses.length, breakeven: be.length, winRate, netProfit, profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : 0, expectancy, avgRR, avgWin: +avgWinR.toFixed(2), avgLoss: +(-avgLossR).toFixed(2), streak, bestSetup: { setup: bestSetup.label, winRate: bestSetup.winRate } },
    deltas,
    bySetup, byTimeframe, byRegime, mistakes, emotions,
    discipline: { score: dScore, rating: dScore >= 90 ? 'Excellent' : dScore >= 75 ? 'Strong' : dScore >= 60 ? 'Fair' : 'Needs Work', delta: discDelta, lastMonth: discLast, checks: discChecks },
    goals, calendar, equity, insights,
  };
}

function buildInsights(d: { bestSetup: { label: string; winRate: number }; mistakes: { mistake: Mistake; count: number }[]; byTimeframe: Bucket[]; winRate: number; avgWinHold: number }): string[] {
  const out: string[] = [];
  if (d.bestSetup.label !== '—') out.push(`You perform best with ${d.bestSetup.label} setups (${d.bestSetup.winRate}% win rate).`);
  const bestTf = [...d.byTimeframe].sort((a, b) => b.winRate - a.winRate)[0];
  if (bestTf) out.push(`Your highest win rate occurs on the ${bestTf.label} timeframe.`);
  if (d.mistakes[0]) out.push(`Your most frequent mistake is "${d.mistakes[0].mistake}" — work on eliminating it.`);
  if (d.avgWinHold) out.push(`Consider holding winners longer; your average winning trade lasts ${(d.avgWinHold / 60).toFixed(1)} hours.`);
  out.push('Avoid trading during ranging market conditions.');
  return out;
}
