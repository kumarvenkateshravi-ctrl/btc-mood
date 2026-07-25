// M-Board (Arch v2) engine. Pure composer over the existing, independent
// alignment pipeline — never recomputes candles into indicator scores itself
// (that's lib/alignment.ts's job); only combines already-computed matrix/
// consensus/weighted into a direction verdict, plus detectStructure for the
// 5m execution-TF's market structure.

import type { Candle, Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { AlignmentMatrix } from '../../alignment';
import { detectStructure, type Consensus, type WeightedScore } from '../../multiTimeframe';
import { BOARD_CONFIG } from './config';
import type { BoardContributor, BoardDecision, BoardDirection, BoardSignal, BoardTrendStrength } from './boardTypes';

function directionOf(bias: BoardDecision['bias'], conviction: number): BoardDirection {
  if (bias === 'neutral') return 'no_trade';
  if (conviction < BOARD_CONFIG.minConviction) return 'no_trade';
  return bias === 'bullish' ? 'long' : 'short';
}

function trendStrengthOf(overall: number): BoardTrendStrength {
  const distance = Math.abs(overall - 50);
  const score = Math.round(Math.min(1, distance / 50) * 100);
  const label = score >= BOARD_CONFIG.strengthBuckets.strong ? 'strong'
    : score >= BOARD_CONFIG.strengthBuckets.moderate ? 'moderate' : 'weak';
  return { score, label };
}

/** How hard the minority is pushing back, on raw score extremity only — NEVER
 *  weighted by TF authority/position (that per-TF-importance weighting is
 *  exactly what caused the original controller-veto bug). Only timeframes
 *  whose verdict OPPOSES the dominant bias count as dissenters; a neutral
 *  read already reduces agreementPct on its own and isn't double-penalized. */
function dissentOf(matrix: AlignmentMatrix, dominantBias: Verdict): { extremity: number; count: number } {
  if (dominantBias === 'neutral') return { extremity: 0, count: 0 };
  const opposing: Verdict = dominantBias === 'bullish' ? 'bearish' : 'bullish';
  const dissentScores = (Object.keys(matrix.tfVerdict) as Timeframe[])
    .filter((tf) => matrix.tfVerdict[tf] === opposing)
    .map((tf) => matrix.tfScore[tf])
    .filter((s): s is number => s != null);
  if (dissentScores.length === 0) return { extremity: 0, count: 0 };
  const extremity = dissentScores.reduce((sum, s) => sum + Math.abs(s - 50) / 50, 0) / dissentScores.length;
  return { extremity, count: dissentScores.length };
}

export function computeBoardDecision(
  matrix: AlignmentMatrix,
  consensus: Consensus,
  weighted: WeightedScore,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): BoardDecision {
  const agreementPct = Math.round((Math.max(consensus.bull, consensus.bear) / Math.max(1, consensus.total)) * 100);
  const { extremity, count } = dissentOf(matrix, weighted.outlook);
  const conviction = Math.round(agreementPct * (1 - BOARD_CONFIG.dissentPenaltyWeight * extremity));
  const direction = directionOf(weighted.outlook, conviction);
  const trendStrength = trendStrengthOf(weighted.overall);
  const marketStructure = detectStructure(candlesByTf['5m'] ?? []);
  const contributors: BoardContributor[] = weighted.perTf.map((p) => ({
    timeframe: p.tf,
    verdict: matrix.tfVerdict[p.tf] ?? 'neutral',
    score: p.score,
    weight: p.weight,
  }));

  const warnings: BoardSignal[] = [];
  if (extremity >= BOARD_CONFIG.strongDissentThreshold) {
    warnings.push({
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: `${count} timeframe(s) strongly oppose the ${weighted.outlook} bias — conviction reduced from ${agreementPct}% to ${conviction}%`,
    });
  }

  return {
    schemaVersion: 1,
    direction,
    bias: weighted.outlook,
    conviction,
    trendStrength,
    marketStructure,
    executionTimeframe: '5m',
    contributors,
    warnings,
  };
}
