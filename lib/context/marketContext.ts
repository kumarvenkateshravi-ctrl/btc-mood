// Market Context Engine — assembler: candlesByTf → MarketContext.
// Closed bars only (each TF's forming bar is dropped) and cached on a
// closed-bar signature, so live ticks are O(1) and nothing repaints.

import type { Candle, Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { CONTEXT_PRODUCERS } from './indicatorScores';
import { trendEngine, momentumEngine, volumeEngine } from './subEngines';
import { blendScores, conflictScore, combineConfidence, biasOf, alignmentScore } from './scoringEngine';
import {
  DEFAULT_CONTEXT_CONFIG,
  type ContextConfig, type ContextIndicatorScore, type ContextWeights,
  type MarketContext, type TfContext,
} from './types';

const MIN_BARS = 40; // below this a TF contributes nothing (warm-up)

function buildTfContext(closed: Candle[], tf: Timeframe, cfg: ContextConfig): TfContext {
  const scores = {} as Record<keyof ContextWeights, ContextIndicatorScore>;
  const items: Array<{ score: number; weight: number }> = [];
  const dataConf: number[] = [];
  for (const key of Object.keys(CONTEXT_PRODUCERS) as Array<keyof ContextWeights>) {
    const s = CONTEXT_PRODUCERS[key](closed, tf);
    scores[key] = s;
    items.push({ score: s.score, weight: cfg.weights[key] });
    dataConf.push(s.confidence);
  }
  const contextScoreV = blendScores(items);
  const conflict = conflictScore(items, contextScoreV);
  return {
    tf,
    indicators: Object.values(scores),
    trendScore: trendEngine(closed, scores),
    momentumScore: momentumEngine(closed, scores),
    volumeScore: volumeEngine(closed, scores),
    contextScore: contextScoreV,
    bias: biasOf(contextScoreV, cfg.neutralBand),
    conflictScore: conflict,
    confidence: combineConfidence(conflict, dataConf),
  };
}

const _cache = new Map<string, MarketContext>();

export function buildMarketContext(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  cfg: ContextConfig = DEFAULT_CONTEXT_CONFIG,
): MarketContext {
  const key = TIMEFRAMES
    .map((tf) => {
      const arr = candlesByTf[tf];
      const nClosed = arr ? arr.length - 1 : 0;
      return `${tf}:${nClosed}:${nClosed > 0 ? arr![nClosed - 1].time : 0}`;
    })
    .join('|') + '|' + JSON.stringify(cfg);
  const hit = _cache.get(key);
  if (hit) return hit;

  const perTf: Partial<Record<Timeframe, TfContext | null>> = {};
  const perTfScore: Partial<Record<Timeframe, number>> = {};
  let asOfTime = 0;

  for (const tf of TIMEFRAMES) {
    const arr = candlesByTf[tf];
    if (!arr || arr.length - 1 < MIN_BARS) { perTf[tf] = null; continue; }
    const closed = arr.slice(0, arr.length - 1); // drop the forming bar
    const tfCtx = buildTfContext(closed, tf, cfg);
    perTf[tf] = tfCtx;
    perTfScore[tf] = tfCtx.contextScore;
    asOfTime = Math.max(asOfTime, closed[closed.length - 1].time);
  }

  const available = TIMEFRAMES.filter((tf) => perTf[tf] != null);
  const contextScoreV = alignmentScore(perTfScore, cfg.tfWeights);
  const htfAgreement = alignmentScore(perTfScore, cfg.tfWeights, cfg.htfTfs);
  const overallBias = biasOf(contextScoreV, cfg.neutralBand);

  const subBlend = (pick: (t: TfContext) => number): number =>
    blendScores(available.map((tf) => ({ score: pick(perTf[tf]!), weight: cfg.tfWeights[tf] })));

  // Overall conflict: per-TF disagreement blended with cross-TF disagreement.
  const crossConflict = conflictScore(
    available.map((tf) => ({ score: perTfScore[tf]!, weight: cfg.tfWeights[tf] })),
    contextScoreV,
  );
  const meanTfConflict = blendScores(
    available.map((tf) => ({ score: perTf[tf]!.conflictScore, weight: cfg.tfWeights[tf] })),
  );
  const conflict = Math.round((crossConflict + meanTfConflict) / 2);
  const confidence = combineConfidence(conflict, available.map((tf) => perTf[tf]!.confidence / 100));

  // Explanations (MTFPlan Phase 7): strongest agreeing facts + opposing warnings.
  const confirmations: string[] = [];
  const warnings: string[] = [];
  const dir = overallBias === 'bullish' ? 1 : overallBias === 'bearish' ? -1 : 0;
  const facts = available
    .flatMap((tf) => perTf[tf]!.indicators)
    .sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  for (const f of facts) {
    const fDir = f.score > 50 ? 1 : f.score < 50 ? -1 : 0;
    if (dir !== 0 && fDir === dir && Math.abs(f.score - 50) >= 15 && confirmations.length < 6) {
      confirmations.push(`${f.timeframe} ${f.explanation}`);
    } else if (dir !== 0 && fDir === -dir && Math.abs(f.score - 50) >= 15 && warnings.length < 4) {
      warnings.push(`${f.timeframe} ${f.explanation}`);
    }
  }
  if (dir === 0) warnings.unshift('Context is mixed — no directional edge');
  if (conflict >= 50) warnings.unshift(`High indicator conflict (${conflict})`);

  const ctx: MarketContext = {
    perTf, overallBias,
    contextScore: Math.round(contextScoreV * 10) / 10,
    trendScore: Math.round(subBlend((t) => t.trendScore) * 10) / 10,
    momentumScore: Math.round(subBlend((t) => t.momentumScore) * 10) / 10,
    volumeScore: Math.round(subBlend((t) => t.volumeScore) * 10) / 10,
    htfAgreement: Math.round(htfAgreement * 10) / 10,
    conflictScore: conflict,
    confidence,
    confirmations, warnings, asOfTime,
  };

  if (_cache.size > 4) _cache.clear();
  _cache.set(key, ctx);
  return ctx;
}
