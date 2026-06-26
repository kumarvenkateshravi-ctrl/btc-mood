// Pure trade-analysis math for the MyStack risk cockpit. Everything here is
// deterministic and unit-tested — no UI, no state. Built on the existing
// position-sizing / reward-risk primitives in ./trading.
//
// Model (internally consistent, risk-first):
//   riskAmount   = balance * risk%               (what you're willing to lose)
//   slDistance   = |entry - stopLoss|
//   positionSize = riskAmount / slDistance       (units, so an SL hit loses exactly riskAmount)
//   positionValue= positionSize * entry          (notional)
//   margin       = positionValue / leverage
//   liquidation  = entry * (1 - 1/lev + mmr)     (long; mirrored for short)

import { positionSize, riskReward, type TradeSide } from './trading';

export type { TradeSide };
export type RiskZone = 'low' | 'moderate' | 'high';
export type ExposureLevel = 'low' | 'moderate' | 'high';

export interface TradeInput {
  balance: number;
  /** Percent of balance to risk on this trade (e.g. 1 = 1%). */
  riskPct: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number;
  side: TradeSide;
  /** Maintenance-margin rate for the liquidation formula. Default 0.5%. */
  maintenanceMarginRate?: number;
}

export interface ChecklistItem {
  label: string;
  pass: boolean;
}

export interface TradeHealth {
  /** 0–100 composite of the weighted checklist. */
  score: number;
  rating: 'Excellent' | 'Good' | 'Risky' | 'Dangerous';
  checklist: ChecklistItem[];
  tips: string[];
}

export interface TradeAnalysis {
  riskAmount: number;
  slDistance: number;
  slDistancePct: number;
  reward: number;
  rewardPct: number;
  positionSize: number;
  positionValue: number;
  /** positionValue / balance, in percent (can exceed 100% with leverage). */
  pctOfAccount: number;
  marginRequired: number;
  potentialLoss: number;
  potentialProfit: number;
  /** Reward-to-risk ratio (null if TP/SL missing or wrong-side). */
  rr: number | null;
  /** Minimum win rate to break even = 1/(1+rr). */
  breakEvenWinRate: number | null;
  liquidationPrice: number;
  liqDistancePct: number;
  exposure: { level: ExposureLevel; ratio: number };
  riskZone: RiskZone;
  whatIfStopLoss: { before: number; loss: number; after: number; changePct: number };
  health: TradeHealth;
}

const DEFAULT_MMR = 0.005;

// ---- Individual derivations (each pure + independently testable) ----

/**
 * Isolated-margin liquidation price. Long liquidates as price falls to
 * entry·(1 − 1/lev + mmr); short as it rises to entry·(1 + 1/lev − mmr).
 */
export function liquidationPrice(
  entry: number,
  leverage: number,
  side: TradeSide,
  mmr: number = DEFAULT_MMR,
): number {
  if (!(entry > 0) || !(leverage > 0)) return NaN;
  const f = 1 / leverage - mmr;
  return side === 'long' ? entry * (1 - f) : entry * (1 + f);
}

/** Minimum win rate to break even given a reward:risk ratio. */
export function breakEvenWinRate(rr: number | null): number | null {
  if (rr == null || !(rr > 0)) return null;
  return 1 / (1 + rr);
}

/** Risk-per-trade zone: ≤1% low, ≤2% moderate, else high. */
export function riskZone(riskPct: number): RiskZone {
  if (riskPct <= 1) return 'low';
  if (riskPct <= 2) return 'moderate';
  return 'high';
}

/** Exposure from notional/balance: <1× low, <3× moderate, else high. */
export function exposureLevel(positionValue: number, balance: number): { level: ExposureLevel; ratio: number } {
  const ratio = balance > 0 ? positionValue / balance : 0;
  const level: ExposureLevel = ratio < 1 ? 'low' : ratio < 3 ? 'moderate' : 'high';
  return { level, ratio };
}

// ---- Trade health (transparent rubric — weights sum to 100) ----

const HEALTH_WEIGHTS = {
  slSet: 25,
  riskOk: 20, // risk ≤ 2%
  rrOk: 25, // R:R ≥ 2
  sizeOk: 15, // margin affordable
  liqSafe: 15, // liq distance > 2× SL distance
} as const;

function computeHealth(checks: {
  slSet: boolean;
  riskOk: boolean;
  rrOk: boolean;
  sizeOk: boolean;
  liqSafe: boolean;
}): TradeHealth {
  const score =
    (checks.slSet ? HEALTH_WEIGHTS.slSet : 0) +
    (checks.riskOk ? HEALTH_WEIGHTS.riskOk : 0) +
    (checks.rrOk ? HEALTH_WEIGHTS.rrOk : 0) +
    (checks.sizeOk ? HEALTH_WEIGHTS.sizeOk : 0) +
    (checks.liqSafe ? HEALTH_WEIGHTS.liqSafe : 0);

  const rating: TradeHealth['rating'] =
    score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Risky' : 'Dangerous';

  const checklist: ChecklistItem[] = [
    { label: 'Stop loss set', pass: checks.slSet },
    { label: 'Risk ≤ 2%', pass: checks.riskOk },
    { label: 'Risk/Reward ≥ 1:2', pass: checks.rrOk },
    { label: 'Position size valid', pass: checks.sizeOk },
    { label: 'Leverage safe', pass: checks.liqSafe },
  ];

  const tips: string[] = [];
  if (!checks.slSet) tips.push('Set a stop loss — without one a single move can wipe the account.');
  if (!checks.riskOk) tips.push('Risking more than 2% per trade compounds drawdowns quickly; consider 1–2%.');
  if (!checks.rrOk) tips.push('Aim for at least a 1:2 reward-to-risk so winners outweigh losers.');
  if (!checks.sizeOk) tips.push('Required margin exceeds your balance — reduce size or leverage.');
  if (!checks.liqSafe) tips.push('Liquidation is close to your stop — lower leverage to widen the buffer.');
  if (tips.length === 0) tips.push('Well-balanced setup with solid risk management. Good to go.');

  return { score, rating, checklist, tips };
}

// ---- The full analysis ----

export function analyzeTrade(input: TradeInput): TradeAnalysis {
  const { balance, riskPct, entry, stopLoss, takeProfit, leverage, side } = input;
  const mmr = input.maintenanceMarginRate ?? DEFAULT_MMR;

  const riskAmount = Math.max(0, balance) * (Math.max(0, riskPct) / 100);
  const slDistance = stopLoss != null ? Math.abs(entry - stopLoss) : 0;
  const slDistancePct = entry > 0 && slDistance > 0 ? (slDistance / entry) * 100 : 0;

  const reward = takeProfit != null ? Math.abs(takeProfit - entry) : 0;
  const rewardPct = entry > 0 && reward > 0 ? (reward / entry) * 100 : 0;

  const size = positionSize(balance, riskPct, slDistance); // units (0 if invalid)
  const positionValue = size * entry;
  const pctOfAccount = balance > 0 ? (positionValue / balance) * 100 : 0;
  const marginRequired = leverage > 0 ? positionValue / leverage : Infinity;

  const potentialLoss = size * slDistance; // == riskAmount by construction
  const potentialProfit = size * reward;

  const rr = riskReward(side, entry, takeProfit, stopLoss);
  const beWin = breakEvenWinRate(rr);

  const liq = liquidationPrice(entry, leverage, side, mmr);
  const liqDistancePct = entry > 0 && Number.isFinite(liq) ? (Math.abs(entry - liq) / entry) * 100 : 0;

  const exposure = exposureLevel(positionValue, balance);
  const zone = riskZone(riskPct);

  const after = balance - potentialLoss;
  const whatIfStopLoss = {
    before: balance,
    loss: potentialLoss,
    after,
    changePct: balance > 0 ? (-potentialLoss / balance) * 100 : 0,
  };

  // SL on the correct side: below entry for long, above for short.
  const slSet =
    stopLoss != null && slDistance > 0 && (side === 'long' ? stopLoss < entry : stopLoss > entry);
  const health = computeHealth({
    slSet,
    riskOk: riskPct > 0 && riskPct <= 2,
    rrOk: rr != null && rr >= 2,
    sizeOk: size > 0 && Number.isFinite(marginRequired) && marginRequired <= balance,
    liqSafe: slDistance > 0 && Math.abs(entry - liq) > 2 * slDistance,
  });

  return {
    riskAmount,
    slDistance,
    slDistancePct,
    reward,
    rewardPct,
    positionSize: size,
    positionValue,
    pctOfAccount,
    marginRequired,
    potentialLoss,
    potentialProfit,
    rr,
    breakEvenWinRate: beWin,
    liquidationPrice: liq,
    liqDistancePct,
    exposure,
    riskZone: zone,
    whatIfStopLoss,
    health,
  };
}
