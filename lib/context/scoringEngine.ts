// Market Context Engine — pure scoring math: weighted blends, conflict,
// confidence, direction adjustment, recency decay, bias banding.

import type { Timeframe } from '../types';
import type { ContextState, TimeframeWeights } from './types';

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
export const clamp01 = (x: number): number => clamp(x, 0, 1);

export interface WeightedScore {
  score: number;  // 0-100
  weight: number; // any non-negative scale; normalized internally
}

/** Weight-normalized blend; 50 (neutral) when nothing to blend. */
export function blendScores(items: WeightedScore[]): number {
  let sw = 0;
  let acc = 0;
  for (const it of items) {
    if (it.weight <= 0) continue;
    sw += it.weight;
    acc += it.weight * clamp(it.score, 0, 100);
  }
  return sw > 0 ? acc / sw : 50;
}

/** Disagreement (refinement 5): weighted mean |score − blended| scaled so that
 *  a 50/50 bull–bear split (scores 0 and 100 around 50) reads 100. */
export function conflictScore(items: WeightedScore[], blended: number): number {
  let sw = 0;
  let acc = 0;
  for (const it of items) {
    if (it.weight <= 0) continue;
    sw += it.weight;
    acc += it.weight * Math.abs(clamp(it.score, 0, 100) - blended);
  }
  return sw > 0 ? clamp((acc / sw) * 2, 0, 100) : 0;
}

/** Confidence ≠ context (refinement 6): agreement × data sufficiency, 0-100. */
export function combineConfidence(conflict: number, dataConfidences: number[]): number {
  const data = dataConfidences.length
    ? dataConfidences.reduce((s, x) => s + x, 0) / dataConfidences.length
    : 0;
  return Math.round(100 * clamp01(1 - conflict / 100) * clamp01(data));
}

/** For sells every score is mirrored so gates read "support for THIS trade". */
export const directionAdjust = (score: number, side: 'buy' | 'sell'): number =>
  side === 'sell' ? 100 - score : score;

/** Neutral is a first-class answer (refinement 4). */
export function biasOf(score: number, neutralBand: number): ContextState {
  if (Math.abs(score - 50) <= neutralBand) return 'neutral';
  return score > 50 ? 'bullish' : 'bearish';
}

/** Event recency decay: deviation from 50 halves every `halfLifeBars`. */
export function decayToward50(score: number, ageBars: number, halfLifeBars: number): number {
  if (halfLifeBars <= 0 || ageBars <= 0) return score;
  return 50 + (score - 50) * Math.pow(2, -ageBars / halfLifeBars);
}

/** Cross-TF alignment: TimeframeWeights blend over the TFs that have data. */
export function alignmentScore(
  perTf: Partial<Record<Timeframe, number>>,
  tfWeights: TimeframeWeights,
  onlyTfs?: Timeframe[],
): number {
  const items: WeightedScore[] = [];
  for (const [tf, score] of Object.entries(perTf) as Array<[Timeframe, number | undefined]>) {
    if (score == null) continue;
    if (onlyTfs && !onlyTfs.includes(tf)) continue;
    items.push({ score, weight: tfWeights[tf] ?? 0 });
  }
  return blendScores(items);
}
