// Market Context Engine — Decision Engine (MTFPlan Phases 8-10, revisedMTF
// refinements 7-11). Consumes VD signal candidates + MarketContext and emits
// graded, risk-profiled Decisions plus explained Rejections (WHY NOT).
// Pure: no UI/chart/store imports.

import type { VdSignal } from '../indicators/vdEngine';
import { clamp, directionAdjust } from './scoringEngine';
import {
  DEFAULT_DECISION_CONFIG,
  type Decision, type DecisionConfig, type MarketContext, type Rejection,
  type RiskProfile, type SignalGrade,
} from './types';

export interface DecideResult {
  decisions: Decision[];
  rejections: Rejection[];
}

export function gradeOf(score: number): SignalGrade {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

export function riskProfileOf(riskScore: number): RiskProfile {
  return riskScore >= 70 ? 'low' : riskScore >= 40 ? 'medium' : 'high';
}

/**
 * Decision score (refinements 7 + 11): the zone weight scales with zone
 * confidence inside `zoneWeightRange`; the remaining weights renormalize to
 * fill 1 − zoneWeight, so Trend/Momentum/Volume stand independent of Context.
 * When context is unavailable (tests, cold start) all context terms read as a
 * neutral 50 and the HTF/bias gates are skipped — graceful degradation.
 */
export function decide(
  candidates: VdSignal[],
  ctx: MarketContext | null,
  cfg: DecisionConfig = DEFAULT_DECISION_CONFIG,
  atrAt?: (index: number) => number | null,
): DecideResult {
  const decisions: Decision[] = [];
  const rejections: Rejection[] = [];
  const w = cfg.weights;
  const restTotal = w.context + w.trend + w.momentum + w.volume + w.risk + w.liquidity;

  for (const s of candidates) {
    const side = s.side;
    const adj = (score: number) => directionAdjust(score, side);
    const contextScore = ctx ? adj(ctx.contextScore) : 50;
    const trend = ctx ? adj(ctx.trendScore) : 50;
    const momentum = ctx ? adj(ctx.momentumScore) : 50;
    const volume = ctx ? adj(ctx.volumeScore) : 50;
    const htf = ctx ? adj(ctx.htfAgreement) : 50;
    const conflict = ctx ? ctx.conflictScore : 50;

    // Risk: SL distance in ATRs (tight = better) blended with (100 − conflict).
    const a = atrAt ? atrAt(s.index) : null;
    const slComponent = a != null && a > 0
      ? 100 - 100 * clamp(Math.abs(s.entry - s.stopLoss) / a / 3, 0, 1)
      : 50;
    const riskScore = (slComponent + (100 - conflict)) / 2;
    const liquidityScore = s.swept ? 100 : 40;

    // Dynamic zone weighting.
    const [lo, hi] = cfg.zoneWeightRange;
    const zoneW = clamp(lo + (hi - lo) * (s.confidence / 100), lo, hi);
    const k = restTotal > 0 ? (1 - zoneW) / restTotal : 0;

    const decisionScore = Math.round(10 * (
      zoneW * s.confidence +
      k * w.context * contextScore +
      k * w.trend * trend +
      k * w.momentum * momentum +
      k * w.volume * volume +
      k * w.risk * riskScore +
      k * w.liquidity * liquidityScore
    )) / 10;

    // Gates — every failure is recorded, never silently dropped (WHY NOT).
    const failedGates: string[] = [];
    if (decisionScore < cfg.minDecisionScore) {
      failedGates.push(`decision score ${decisionScore} < ${cfg.minDecisionScore}`);
    }
    if (ctx) {
      if (htf < cfg.htfFloor) {
        failedGates.push(`higher-TF agreement ${Math.round(htf)} < ${cfg.htfFloor}`);
      }
      const opposing = side === 'buy' ? 'bearish' : 'bullish';
      if (ctx.overallBias === opposing) {
        failedGates.push(`overall context bias is ${ctx.overallBias}`);
      }
    }

    if (failedGates.length > 0) {
      rejections.push({ signal: s, decisionScore, failedGates });
      continue;
    }

    const reasons: string[] = [
      `Zone confidence ${Math.round(s.confidence)}`,
      ...(s.swept ? ['Liquidity sweep + reclaim'] : []),
      ...(ctx ? ctx.confirmations.slice(0, 4) : []),
    ];
    const warnings = ctx ? [...ctx.warnings] : ['Market context unavailable'];

    decisions.push({
      signal: s,
      decisionScore,
      grade: gradeOf(decisionScore),
      riskProfile: riskProfileOf(riskScore),
      contextScore: Math.round(contextScore * 10) / 10,
      htfAgreement: Math.round(htf * 10) / 10,
      conflictScore: conflict,
      reasons, warnings,
    });
  }

  return { decisions, rejections };
}
