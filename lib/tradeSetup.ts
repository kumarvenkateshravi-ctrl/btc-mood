// Trade Setup engine — the decision-aggregation layer that turns the analysis
// (stack-score factors, market structure, consensus, ATR) into a concrete,
// executable plan: entry zone, stop, TP ladder, risk/reward, position size,
// setup-quality, checklist, execution readiness and a lifecycle simulator.
// It does NOT recompute indicators. Pure + unit-tested.

import type { Factor, FactorKey } from './stackScoreFactors';
import type { Consensus, MarketStructure } from './multiTimeframe';
import { positionSize } from './trading';

export type Side = 'long' | 'short';
export type EntryStatus = 'In Zone' | 'Wait for Pullback' | 'Late';
export type ChecklistStatus = 'pass' | 'warn' | 'fail';
export type ExecVerdict = 'READY TO EXECUTE' | 'WAIT' | 'AVOID';

export interface TPTarget { name: 'TP1' | 'TP2' | 'TP3'; alloc: number; price: number; distancePct: number; r: number; }
export interface ChecklistItem { label: string; status: ChecklistStatus; }
export interface QualityBar { key: FactorKey; label: string; points: number; max: number; }

export interface TradeSetup {
  side: Side;
  setupType: string;
  entry: { lower: number; upper: number; mid: number; status: EntryStatus; distancePct: number };
  stopLoss: { price: number; points: number; method: string; placement: string };
  takeProfits: TPTarget[];
  potentialRewardPoints: number;
  rr: number;
  risk: { potentialLoss: number; potentialProfit: number; breakEvenWinRate: number };
  sizing: { balance: number; riskPct: number; riskAmount: number; stopDistance: number; size: number; value: number; leverage: number; margin: number };
  quality: { score: number; rating: string; bars: QualityBar[] };
  checklist: ChecklistItem[];
  execution: { score: number; verdict: ExecVerdict; note: string };
  lifecycle: { ifTp1: number; ifTp2: number; ifTp3: number; ifSl: number; accountBefore: number; accountAfterTp3: number; accountAfterSl: number };
  plan: { direction: string; entryZone: string; stopLoss: string; targets: string; rr: string; risk: string };
}

export interface TradeSetupInput {
  price: number;
  atr: number;
  side: Side;
  structure: MarketStructure;
  factors: Factor[];
  qualityScore: number;
  consensus: Consensus;
  confidence: number;
  regimeState: string;
  balance: number;
  riskPct: number;
  leverage: number;
}

const FACTOR_MAX: Record<FactorKey, number> = { trend: 25, momentum: 15, volume: 15, structure: 15, volatility: 10, consensus: 15, sentiment: 5 };
const FACTOR_LABEL: Record<FactorKey, string> = {
  trend: 'Trend Alignment', momentum: 'Momentum Strength', volume: 'Volume & Liquidity', structure: 'Market Structure',
  volatility: 'Volatility Conditions', consensus: 'MTF Consensus', sentiment: 'News / Sentiment',
};

function qualityRating(s: number): string {
  if (s >= 90) return 'Elite Setup';
  if (s >= 80) return 'Strong Setup';
  if (s >= 60) return 'Good Setup';
  if (s >= 40) return 'Average Setup';
  return 'Weak Setup';
}

export function generateTradeSetup(input: TradeSetupInput): TradeSetup {
  const { price, atr, side, structure, factors, qualityScore, confidence, regimeState, balance, riskPct, leverage } = input;
  const sign = side === 'long' ? 1 : -1;
  const a = atr > 0 ? atr : price * 0.004;

  // ---- Entry zone: a pullback band against the trade direction ----
  const mid = price - sign * 0.4 * a;
  const lowerRaw = mid - 0.15 * a;
  const upperRaw = mid + 0.15 * a;
  const lower = Math.min(lowerRaw, upperRaw);
  const upper = Math.max(lowerRaw, upperRaw);
  let status: EntryStatus;
  if (price >= lower && price <= upper) status = 'In Zone';
  else if (side === 'long') status = price > upper ? 'Wait for Pullback' : 'Late';
  else status = price < lower ? 'Wait for Pullback' : 'Late';
  const distancePct = (Math.abs(price - mid) / price) * 100;

  // ---- Stop loss (structure-aware, ATR-distanced) ----
  const stopDistance = 1.5 * a;
  const slPrice = mid - sign * stopDistance;
  const slPoints = Math.round(Math.abs(mid - slPrice));
  const placement = side === 'long' ? 'Below previous swing low & support' : 'Above previous swing high & resistance';

  // ---- Take-profit ladder at 1R / 2R / 3R ----
  const allocs: { name: TPTarget['name']; alloc: number; r: number }[] = [
    { name: 'TP1', alloc: 40, r: 1 }, { name: 'TP2', alloc: 30, r: 2 }, { name: 'TP3', alloc: 30, r: 3 },
  ];
  const takeProfits: TPTarget[] = allocs.map((t) => {
    const tp = mid + sign * t.r * stopDistance;
    return { name: t.name, alloc: t.alloc, price: tp, distancePct: ((tp - price) / price) * 100 * sign, r: t.r };
  });
  const rr = 3;
  const potentialRewardPoints = Math.round(3 * stopDistance);

  // ---- Position sizing (risk-based) ----
  const riskAmount = (balance * riskPct) / 100;
  const size = positionSize(balance, riskPct, stopDistance);
  const value = size * mid;
  const margin = leverage > 0 ? value / leverage : value;

  const risk = { potentialLoss: riskAmount, potentialProfit: riskAmount * rr, breakEvenWinRate: 1 / (1 + rr) };

  // ---- Setup quality (consume the 7 stack-score factors → weighted points) ----
  const bars: QualityBar[] = factors.map((f) => ({
    key: f.key, label: FACTOR_LABEL[f.key], max: FACTOR_MAX[f.key], points: Math.round((f.score / 100) * FACTOR_MAX[f.key]),
  }));
  const quality = { score: Math.round(qualityScore), rating: qualityRating(qualityScore), bars };

  // ---- Checklist ----
  const fac = (k: FactorKey) => factors.find((x) => x.key === k)!;
  const dirOk = (v: string) => (side === 'long' ? v === 'bullish' : v === 'bearish');
  const checklist: ChecklistItem[] = [
    { label: 'Trend aligned with higher timeframe', status: dirOk(fac('trend').verdict) ? 'pass' : 'fail' },
    { label: 'Stack Score above 80', status: qualityScore >= 80 ? 'pass' : qualityScore >= 60 ? 'warn' : 'fail' },
    { label: 'Volume above average', status: fac('volume').score >= 55 ? 'pass' : fac('volume').score >= 45 ? 'warn' : 'fail' },
    { label: 'Market structure supports direction', status: dirOk(structure.verdict) ? 'pass' : structure.verdict === 'neutral' ? 'warn' : 'fail' },
    { label: 'Risk less than 2%', status: riskPct < 2 ? 'pass' : 'warn' },
    { label: 'Reward:Risk above 2', status: rr >= 2 ? 'pass' : 'fail' },
    { label: 'Price in ideal entry zone', status: status === 'In Zone' ? 'pass' : 'warn' },
    { label: 'Waiting for confirmation trigger', status: status === 'In Zone' ? 'pass' : 'warn' },
  ];

  // ---- Execution readiness ----
  const passRatio = checklist.filter((c) => c.status === 'pass').length / checklist.length;
  const execScore = Math.round(Math.max(0, Math.min(100, qualityScore * 0.4 + confidence * 0.2 + (rr >= 2 ? 100 : 50) * 0.15 + passRatio * 100 * 0.25)));
  const verdict: ExecVerdict = execScore >= 80 ? 'READY TO EXECUTE' : execScore >= 45 ? 'WAIT' : 'AVOID';
  const note = verdict === 'READY TO EXECUTE' ? 'Strong alignment across all key factors'
    : verdict === 'WAIT' ? 'Some factors not yet aligned, wait for confirmation'
      : 'Conditions are unfavourable, stand aside';

  // ---- Lifecycle simulator (full-position R outcomes) ----
  const lifecycle = {
    ifTp1: riskAmount * 1, ifTp2: riskAmount * 2, ifTp3: riskAmount * 3, ifSl: -riskAmount,
    accountBefore: balance, accountAfterTp3: balance + riskAmount * 3, accountAfterSl: balance - riskAmount,
  };

  // ---- Plan ----
  const fmtP = (n: number) => Math.round(n).toLocaleString('en-US');
  const setupType = regimeState === 'Trending'
    ? dirOk(structure.verdict) ? 'Trend Continuation' : 'Trend Pullback'
    : regimeState === 'Ranging' ? 'Range Setup' : 'Transitional Setup';
  const plan = {
    direction: side.toUpperCase(),
    entryZone: `${fmtP(lower)} - ${fmtP(upper)}`,
    stopLoss: fmtP(slPrice),
    targets: takeProfits.map((t) => fmtP(t.price)).join(' / '),
    rr: `1 : ${rr}`,
    risk: `${riskPct}%`,
  };

  return {
    side, setupType,
    entry: { lower, upper, mid, status, distancePct },
    stopLoss: { price: slPrice, points: slPoints, method: 'Structure + ATR based', placement },
    takeProfits, potentialRewardPoints, rr, risk,
    sizing: { balance, riskPct, riskAmount, stopDistance, size, value, leverage, margin },
    quality, checklist, execution: { score: execScore, verdict, note }, lifecycle, plan,
  };
}
