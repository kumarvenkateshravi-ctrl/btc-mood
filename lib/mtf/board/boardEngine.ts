// M-Board (Arch v2.1) engine. Pure composer over the independent alignment
// matrix (lib/alignment.ts) — never recomputes candles into indicator scores
// itself; it combines the per-TF verdicts/scores into a direction verdict using
// EXECUTION-PRIMARY weighting, plus detectStructure for the 5m market structure.
//
// Arch v2.1 (2026-07-26): direction & conviction are now driven by BOARD_TF_WEIGHTS
// (5m/15m/30m = 0.80 of the weight), NOT the higher-TF-heavy global TF_WEIGHT.
// The 1h/4h/1d are context: they shave conviction (and dent it via the dissent
// penalty) but can no longer drag a leaning execution cluster into 'neutral'.
// This is the fix for "higher timeframe controls the lower timeframe," applied to
// the Board's own direction call. The Board no longer consumes consensus/weighted.
// Spec: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import { TIMEFRAMES, type Candle, type Timeframe } from '../../types';
import { verdictOf, type Verdict } from '../types';
import type { AlignmentMatrix } from '../../alignment';
import { detectStructure } from '../../multiTimeframe';
import { BOARD_CONFIG, BOARD_TF_WEIGHTS } from './config';
import type { BoardContributor, BoardDecision, BoardDirection, BoardSignal, BoardTrendStrength } from './boardTypes';

function directionOf(bias: Verdict, conviction: number): BoardDirection {
  if (bias === 'neutral') return 'no_trade';
  if (conviction < BOARD_CONFIG.minConviction) return 'no_trade';
  return bias === 'bullish' ? 'long' : 'short';
}

function trendStrengthOf(boardScore: number): BoardTrendStrength {
  const distance = Math.abs(boardScore - 50);
  const score = Math.round(Math.min(1, distance / 50) * 100);
  const label = score >= BOARD_CONFIG.strengthBuckets.strong ? 'strong'
    : score >= BOARD_CONFIG.strengthBuckets.moderate ? 'moderate' : 'weak';
  return { score, label };
}

/** Execution-primary weighted mean of the per-TF scores (renormalized over the
 *  TFs actually present). 50 = neutral when nothing is present. */
function boardScoreOf(matrix: AlignmentMatrix): number {
  let sum = 0;
  let wsum = 0;
  for (const tf of TIMEFRAMES) {
    const s = matrix.tfScore[tf];
    if (s == null) continue;
    const w = BOARD_TF_WEIGHTS[tf];
    sum += s * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : 50;
}

/** Board-weighted agreement toward `bias`: the share of the present board-weight
 *  carried by TFs whose verdict matches the bias. Neutrals count as non-support
 *  (they neither confirm nor oppose), so a lone leaning TF can't fake conviction. */
function agreementPctOf(matrix: AlignmentMatrix, bias: Verdict): number {
  if (bias === 'neutral') return 0;
  let agree = 0;
  let present = 0;
  for (const tf of TIMEFRAMES) {
    if (matrix.tfVerdict[tf] == null) continue;
    const w = BOARD_TF_WEIGHTS[tf];
    present += w;
    if (matrix.tfVerdict[tf] === bias) agree += w;
  }
  return present > 0 ? Math.round((agree / present) * 100) : 0;
}

/** How hard the minority is pushing back, on raw score extremity only — NEVER
 *  weighted by TF position. Only timeframes whose verdict OPPOSES the bias count
 *  as dissenters; a neutral read already withholds support in agreementPct and
 *  isn't double-penalized. A strongly-opposed higher TF still dents conviction
 *  here (context downgrade) without vetoing the execution-decided direction. */
function dissentOf(matrix: AlignmentMatrix, bias: Verdict): { extremity: number; count: number } {
  if (bias === 'neutral') return { extremity: 0, count: 0 };
  const opposing: Verdict = bias === 'bullish' ? 'bearish' : 'bullish';
  const dissentScores = TIMEFRAMES
    .filter((tf) => matrix.tfVerdict[tf] === opposing)
    .map((tf) => matrix.tfScore[tf])
    .filter((s): s is number => s != null);
  if (dissentScores.length === 0) return { extremity: 0, count: 0 };
  const extremity = dissentScores.reduce((sum, s) => sum + Math.abs(s - 50) / 50, 0) / dissentScores.length;
  return { extremity, count: dissentScores.length };
}

export function computeBoardDecision(
  matrix: AlignmentMatrix,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): BoardDecision {
  const boardScore = boardScoreOf(matrix);
  const bias = verdictOf(boardScore);
  const agreementPct = agreementPctOf(matrix, bias);
  const { extremity, count } = dissentOf(matrix, bias);
  const conviction = Math.round(agreementPct * (1 - BOARD_CONFIG.dissentPenaltyWeight * extremity));
  const direction = directionOf(bias, conviction);
  const trendStrength = trendStrengthOf(boardScore);
  const marketStructure = detectStructure(candlesByTf['5m'] ?? []);

  const contributors: BoardContributor[] = TIMEFRAMES
    .filter((tf) => matrix.tfScore[tf] != null)
    .map((tf) => ({
      timeframe: tf,
      verdict: matrix.tfVerdict[tf] ?? 'neutral',
      score: matrix.tfScore[tf]!,
      weight: BOARD_TF_WEIGHTS[tf],
    }));

  const warnings: BoardSignal[] = [];
  if (extremity >= BOARD_CONFIG.strongDissentThreshold) {
    warnings.push({
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: `${count} higher/opposing timeframe(s) push against the ${bias} execution bias — conviction reduced from ${agreementPct}% to ${conviction}%`,
    });
  }

  return {
    schemaVersion: 1,
    direction,
    bias,
    conviction,
    trendStrength,
    marketStructure,
    executionTimeframe: '5m',
    contributors,
    warnings,
  };
}
