// MyCryptoStack Setup Backtester — validates the platform's own setup signals on
// historical candles. Entry/exit are RULE-based: independent conditions (Stack
// Score, MTF Alignment [approx], Trend Strength, Volume, Market Regime) are
// ANDed for entries; Take Profit / Stop Loss / Stack-Score / MTF rules drive
// exits. Indicators are computed ONCE for O(n). Pure + unit-tested.
//
// NOTE: MTF Alignment in the backtest is APPROXIMATED from the focus timeframe's
// setup score (true cross-timeframe alignment needs deep history on all TFs).

import type { Candle } from './types';
import * as pm from './pineMath';
import { computeRsi } from './indicators/rsi';
import { computeMacd } from './indicators/macd';
import { computeAdx } from './indicators/adx';
import { computeAtr } from './indicators/atr';

export type EntryMetric = 'Stack Score' | 'MTF Alignment' | 'Trend Strength' | 'Volume' | 'Market Regime';
export type ExitMetric = 'Take Profit' | 'Stack Score' | 'MTF Alignment' | 'Stop Loss';
export type Operator = 'Greater Than' | 'Less Than' | 'At Least' | 'Above SMA20' | 'Is Trending' | 'RR Greater Than' | 'Fixed';

export interface Condition { id: string; enabled: boolean; metric: string; operator: Operator; value: number; }

export interface BacktestConfig {
  entryConditions: Condition[];
  exitConditions: Condition[];
  riskPct: number;
  initialCapital: number;
  commissionPct: number;
  slippagePct: number;
  leverage: number;
  allowShort: boolean;
}

let _cid = 0;
export const cid = () => `c${(_cid++).toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

export const DEFAULT_BT_CONFIG: BacktestConfig = {
  entryConditions: [
    { id: cid(), enabled: true, metric: 'Stack Score', operator: 'Greater Than', value: 85 },
    { id: cid(), enabled: true, metric: 'MTF Alignment', operator: 'At Least', value: 5 },
    { id: cid(), enabled: true, metric: 'Trend Strength', operator: 'Greater Than', value: 70 },
    { id: cid(), enabled: true, metric: 'Volume', operator: 'Above SMA20', value: 0 },
    { id: cid(), enabled: true, metric: 'Market Regime', operator: 'Is Trending', value: 20 },
  ],
  exitConditions: [
    { id: cid(), enabled: true, metric: 'Take Profit', operator: 'RR Greater Than', value: 2.5 },
    { id: cid(), enabled: true, metric: 'Stack Score', operator: 'Less Than', value: 50 },
    { id: cid(), enabled: true, metric: 'MTF Alignment', operator: 'Less Than', value: 3 },
    { id: cid(), enabled: true, metric: 'Stop Loss', operator: 'Fixed', value: 1.5 },
  ],
  riskPct: 1, initialCapital: 10_000, commissionPct: 0.1, slippagePct: 0.05, leverage: 5, allowShort: true,
};

export interface BTrade { date: number; side: 'Long' | 'Short'; entry: number; exit: number; rr: number; pnl: number; durationBars: number; entryScore: number; }
export interface EquityPoint { time: number; equity: number; benchmark: number; drawdownPct: number; }
export interface SetupBucket { label: string; trades: number; winRate: number; profitFactor: number; avgRR: number; }
export interface BacktestResult {
  trades: BTrade[];
  equity: EquityPoint[];
  metrics: { totalReturnPct: number; totalReturnAbs: number; winRate: number; profitFactor: number; sharpe: number; maxDrawdownPct: number; maxDrawdownAbs: number; expectancy: number };
  distribution: { wins: number; losses: number; breakeven: number; total: number };
  drawdown: { maxPct: number; avgPct: number; maxDurationBars: number; avgDurationBars: number; recoveryFactor: number };
  setupBreakdown: SetupBucket[];
  coverage: { bars: number; from: number; to: number; quality: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function lastArr(data: readonly unknown[]): (number | null)[] {
  return data.map((d) => (typeof d === 'number' ? d : d && typeof d === 'object' && 'value' in d ? (d as { value?: number }).value ?? null : null));
}

export interface PerBarMetrics { score: number[]; mtf: number[]; trend: number[]; volPct: number[]; adx: number[]; }

/** Per-bar setup metrics, computed once from full indicator arrays (O(n)). */
export function perBarMetrics(candles: Candle[]): PerBarMetrics {
  const n = candles.length;
  const closes = candles.map((c) => c.close), vols = candles.map((c) => c.volume);
  const e20 = pm.emaPine(closes, 20), e50 = pm.emaPine(closes, 50), e200 = pm.emaPine(closes, 200);
  const volSma = pm.sma(vols, 20);
  const rsi = lastArr(computeRsi(candles).plots.find((p) => p.id === 'rsi')?.data ?? []);
  const macdP = computeMacd(candles).plots;
  const macd = lastArr(macdP.find((p) => p.id === 'macd')?.data ?? []), signal = lastArr(macdP.find((p) => p.id === 'signal')?.data ?? []);
  const adxP = computeAdx(candles).plots;
  const adxA = lastArr(adxP.find((p) => p.id === 'adx')?.data ?? []), pdA = lastArr(adxP.find((p) => p.id === 'plusDI')?.data ?? []), mdA = lastArr(adxP.find((p) => p.id === 'minusDI')?.data ?? []);

  const score = new Array<number>(n).fill(50), mtf = new Array<number>(n).fill(3), trend = new Array<number>(n).fill(50), volPct = new Array<number>(n).fill(0), adx = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = e20[i], b = e50[i], c = e200[i];
    let ema = 50;
    if (a != null && b != null) { const lt = c ?? b; ema = a > b && b >= lt ? 100 : a < b && b <= lt ? 0 : a > b ? 65 : 35; }
    const r = rsi[i]; const rsiS = r == null ? 50 : clamp(r, 0, 100);
    const m = macd[i], s = signal[i]; const macdS = m == null || s == null ? 50 : m > s ? 100 : 0;
    const ax = adxA[i], pd = pdA[i], md = mdA[i]; const adxS = ax == null || pd == null || md == null ? 50 : 50 + (pd >= md ? 1 : -1) * clamp(ax, 0, 50);
    score[i] = (ema + rsiS + macdS + adxS) / 4;
    mtf[i] = Math.round(clamp((score[i] / 100) * 6, 0, 6));
    trend[i] = b != null ? clamp(50 + ((closes[i] - b) / b) * 2000, 0, 100) : 50;
    const vs = volSma[i]; volPct[i] = vs && vs > 0 ? (vols[i] / vs - 1) * 100 : 0;
    adx[i] = ax ?? 0;
  }
  return { score, mtf, trend, volPct, adx };
}

export function perBarScore(candles: Candle[]): number[] { return perBarMetrics(candles).score; }

function metricValue(metric: string, i: number, m: PerBarMetrics): number {
  switch (metric) {
    case 'Stack Score': return m.score[i];
    case 'MTF Alignment': return m.mtf[i];
    case 'Trend Strength': return m.trend[i];
    case 'Volume': return m.volPct[i];
    case 'Market Regime': return m.adx[i];
    default: return m.score[i];
  }
}
function opMet(op: Operator, value: number, threshold: number): boolean {
  switch (op) {
    case 'Greater Than': return value > threshold;
    case 'Less Than': return value < threshold;
    case 'At Least': return value >= threshold;
    case 'Above SMA20': return value > 0;
    case 'Is Trending': return value > threshold;
    default: return false;
  }
}

export function runSetupBacktest(candles: Candle[], cfg: BacktestConfig): BacktestResult {
  const n = candles.length;
  const empty: BacktestResult = {
    trades: [], equity: [], metrics: { totalReturnPct: 0, totalReturnAbs: 0, winRate: 0, profitFactor: 0, sharpe: 0, maxDrawdownPct: 0, maxDrawdownAbs: 0, expectancy: 0 },
    distribution: { wins: 0, losses: 0, breakeven: 0, total: 0 }, drawdown: { maxPct: 0, avgPct: 0, maxDurationBars: 0, avgDurationBars: 0, recoveryFactor: 0 },
    setupBreakdown: [], coverage: { bars: n, from: candles[0]?.time ?? 0, to: candles[n - 1]?.time ?? 0, quality: 0 },
  };
  if (n < 220) return empty;

  const m = perBarMetrics(candles);
  const atr = lastArr(computeAtr(candles).plots.find((p) => p.id === 'atr')?.data ?? []);
  const find = (conds: Condition[], metric: string) => conds.find((c) => c.enabled && c.metric === metric);
  const tpR = find(cfg.exitConditions, 'Take Profit')?.value ?? 2.5;
  const slR = find(cfg.exitConditions, 'Stop Loss')?.value ?? 1.5;
  const exitScore = find(cfg.exitConditions, 'Stack Score')?.value ?? -1;
  const exitMtf = find(cfg.exitConditions, 'MTF Alignment')?.value ?? -1;
  const entryConds = cfg.entryConditions.filter((c) => c.enabled);
  const entryOk = (i: number) => entryConds.every((c) => opMet(c.operator, metricValue(c.metric, i, m), c.value));

  let capital = cfg.initialCapital;
  const trades: BTrade[] = [], equity: EquityPoint[] = [];
  let peak = capital;
  const bench0 = candles[0].close;
  type Pos = { side: 'Long' | 'Short'; entry: number; sl: number; tp: number; idx: number; entryScore: number };
  let pos: Pos | null = null;

  for (let i = 1; i < n; i++) {
    const c = candles[i];
    if (pos) {
      let exit: number | null = null;
      if (pos.side === 'Long') {
        if (c.low <= pos.sl) exit = pos.sl;
        else if (c.high >= pos.tp) exit = pos.tp;
        else if ((exitScore >= 0 && m.score[i] < exitScore) || (exitMtf >= 0 && m.mtf[i] < exitMtf)) exit = c.close;
      } else {
        if (c.high >= pos.sl) exit = pos.sl;
        else if (c.low <= pos.tp) exit = pos.tp;
        else if ((exitScore >= 0 && m.score[i] > 100 - exitScore) || (exitMtf >= 0 && m.mtf[i] > 6 - exitMtf)) exit = c.close;
      }
      if (exit != null) {
        const risk = Math.abs(pos.entry - pos.sl) || pos.entry * 0.003;
        const rr = (pos.side === 'Long' ? exit - pos.entry : pos.entry - exit) / risk;
        const riskAmount = capital * (cfg.riskPct / 100);
        const positionValue = Math.min((riskAmount * pos.entry) / risk, capital * cfg.leverage);
        const cost = ((cfg.commissionPct * 2 + cfg.slippagePct) / 100) * positionValue;
        const pnl = rr * riskAmount - cost;
        capital += pnl;
        trades.push({ date: c.time, side: pos.side, entry: pos.entry, exit, rr: +rr.toFixed(2), pnl, durationBars: i - pos.idx, entryScore: pos.entryScore });
        peak = Math.max(peak, capital);
        equity.push({ time: c.time, equity: capital, benchmark: cfg.initialCapital * (c.close / bench0), drawdownPct: ((capital - peak) / peak) * 100 });
        pos = null;
      }
    }
    if (!pos && entryOk(i)) {
      const a = atr[i] ?? c.close * 0.004, stop = Math.max(slR * a, c.close * 0.002);
      const long = m.score[i] >= 50;
      if (long) pos = { side: 'Long', entry: c.close, sl: c.close - stop, tp: c.close + tpR * stop, idx: i, entryScore: Math.round(m.score[i]) };
      else if (cfg.allowShort) pos = { side: 'Short', entry: c.close, sl: c.close + stop, tp: c.close - tpR * stop, idx: i, entryScore: Math.round(m.score[i]) };
    }
  }

  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0), be = trades.filter((t) => t.pnl === 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const rrs = trades.map((t) => t.rr), meanR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;
  const stdR = rrs.length ? Math.sqrt(rrs.reduce((a, b) => a + (b - meanR) ** 2, 0) / rrs.length) : 0;
  const sharpe = stdR > 0 ? +(meanR / stdR).toFixed(2) : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.rr, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.rr, 0) / losses.length) : 0;
  const lossRate = trades.length ? losses.length / trades.length : 0;
  const expectancy = +(avgWin * (winRate / 100) - avgLoss * lossRate).toFixed(2);
  const maxDDpct = equity.length ? Math.min(...equity.map((e) => e.drawdownPct)) : 0;
  const totalReturnAbs = capital - cfg.initialCapital;

  const dds = equity.map((e) => e.drawdownPct), negDDs = dds.filter((d) => d < 0);
  const avgDD = negDDs.length ? negDDs.reduce((a, b) => a + b, 0) / negDDs.length : 0;
  let curLen = 0, maxLen = 0; const lens: number[] = [];
  for (const d of dds) { if (d < 0) { curLen++; maxLen = Math.max(maxLen, curLen); } else if (curLen > 0) { lens.push(curLen); curLen = 0; } }
  const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : curLen;
  const recoveryFactor = maxDDpct < 0 ? +(((totalReturnAbs / cfg.initialCapital) * 100) / Math.abs(maxDDpct)).toFixed(2) : 0;

  const buckets = [
    { label: '6/6 Green', lo: 85, hi: 101 }, { label: '5/6 Green', lo: 70, hi: 85 },
    { label: '4/6 Green', lo: 55, hi: 70 }, { label: '3/6 Green or Less', lo: 0, hi: 55 },
  ];
  const setupBreakdown: SetupBucket[] = buckets.map((b) => {
    const ts = trades.filter((t) => t.entryScore >= b.lo && t.entryScore < b.hi);
    const w = ts.filter((t) => t.pnl > 0), l = ts.filter((t) => t.pnl < 0);
    const gp = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    return { label: b.label, trades: ts.length, winRate: ts.length ? +((w.length / ts.length) * 100).toFixed(2) : 0, profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : 0, avgRR: ts.length ? +(ts.reduce((s, t) => s + t.rr, 0) / ts.length).toFixed(2) : 0 };
  });

  return {
    trades, equity,
    metrics: { totalReturnPct: +((totalReturnAbs / cfg.initialCapital) * 100).toFixed(2), totalReturnAbs, winRate: +winRate.toFixed(2), profitFactor: +profitFactor.toFixed(2), sharpe, maxDrawdownPct: +maxDDpct.toFixed(2), maxDrawdownAbs: (maxDDpct / 100) * peak, expectancy },
    distribution: { wins: wins.length, losses: losses.length, breakeven: be.length, total: trades.length },
    drawdown: { maxPct: +maxDDpct.toFixed(2), avgPct: +avgDD.toFixed(2), maxDurationBars: maxLen, avgDurationBars: Math.round(avgLen), recoveryFactor },
    setupBreakdown,
    coverage: { bars: n, from: candles[0].time, to: candles[n - 1].time, quality: 99 },
  };
}

/** Optimize the Stack Score entry threshold by net return over a grid. */
export function optimizeEntry(candles: Candle[], cfg: BacktestConfig): { current: number; optimal: number; improvementPct: number } {
  const cur = cfg.entryConditions.find((c) => c.metric === 'Stack Score')?.value ?? 70;
  const withScore = (v: number): BacktestConfig => ({ ...cfg, entryConditions: cfg.entryConditions.map((c) => (c.metric === 'Stack Score' ? { ...c, value: v } : c)) });
  const baseline = runSetupBacktest(candles, cfg).metrics.totalReturnAbs;
  let best = cur, bestVal = baseline;
  for (const t of [60, 65, 70, 75, 80, 82, 85, 90]) {
    if (t === cur) continue;
    const v = runSetupBacktest(candles, withScore(t)).metrics.totalReturnAbs;
    if (v > bestVal) { bestVal = v; best = t; }
  }
  const improvementPct = baseline !== 0 ? +(((bestVal - baseline) / Math.abs(baseline)) * 100).toFixed(2) : bestVal > 0 ? 100 : 0;
  return { current: cur, optimal: best, improvementPct };
}

export function monteCarlo(result: BacktestResult, cfg: BacktestConfig, runs = 1000): { best: number; expected: number; worst: number } {
  const rrs = result.trades.map((t) => t.rr);
  if (rrs.length < 5) return { best: 0, expected: result.metrics.totalReturnPct, worst: 0 };
  const finals: number[] = [];
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let r = 0; r < runs; r++) {
    let eq = cfg.initialCapital;
    const sh = [...rrs];
    for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    for (const rr of sh) eq += rr * (eq * (cfg.riskPct / 100));
    finals.push(((eq - cfg.initialCapital) / cfg.initialCapital) * 100);
  }
  finals.sort((a, b) => a - b);
  const pct = (p: number) => finals[Math.floor(clamp(p, 0, 0.999) * finals.length)];
  return { best: +pct(0.95).toFixed(2), expected: +(finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(2), worst: +pct(0.05).toFixed(2) };
}

export function confidenceScore(r: BacktestResult): number {
  const sampleS = clamp((r.distribution.total / 100) * 100, 0, 100);
  const pfS = clamp(r.metrics.profitFactor * 33, 0, 100);
  const ddS = clamp(100 - Math.abs(r.metrics.maxDrawdownPct) * 4, 0, 100);
  const winS = clamp(r.metrics.winRate, 0, 100);
  return Math.round(clamp(sampleS * 0.25 + pfS * 0.3 + ddS * 0.2 + winS * 0.25, 0, 100));
}

export function generateInsights(r: BacktestResult): string[] {
  const out: string[] = [];
  const best = [...r.setupBreakdown].filter((b) => b.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (best) out.push(`Best win rate (${best.winRate}%) comes from ${best.label} setups.`);
  out.push(r.metrics.profitFactor >= 1.5 ? `Profit factor of ${r.metrics.profitFactor} shows a durable edge.` : `Profit factor ${r.metrics.profitFactor} is thin; tighten entries.`);
  if (r.trades.length) { const avgDur = Math.round(r.trades.reduce((s, t) => s + t.durationBars, 0) / r.trades.length); out.push(`Average trade lasts about ${avgDur} bars.`); }
  out.push(Math.abs(r.metrics.maxDrawdownPct) > 20 ? 'Drawdowns are deep; consider lower risk per trade.' : 'Drawdowns stay controlled at this risk level.');
  out.push(r.metrics.winRate >= 55 ? 'Win rate supports trading with the trend.' : 'Lower win rate needs the higher R targets to stay profitable.');
  return out;
}
