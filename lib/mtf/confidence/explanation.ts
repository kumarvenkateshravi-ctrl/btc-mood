// M4 — Confidence explanation. Generic codes; any category named in a message is
// interpolated from data (never hardcoded branching). Every warning maps to a real
// penalty contributor or a configured category threshold. Spec §Explanation.

import type { CategoryResult } from '../categoryTypes';
import type { ConfidenceContributor, ConfidenceSignal } from './confidenceTypes';
import { CATEGORY_CONFIDENCE_FACTORS, CONFIDENCE_THRESHOLDS } from './config';

export interface ExplainConfidenceContext {
  confidence: number;
  raw: number;
  indConf: number;
  catConf: number;
  agrConf: number;
  completeness: number;
  categories: CategoryResult[];
  penaltyContribs: ConfidenceContributor[];
}

const sig = (code: string, message: string, severity: ConfidenceSignal['severity']): ConfidenceSignal => ({ code, message, severity });

export function explainConfidence(ctx: ExplainConfidenceContext): { signals: ConfidenceSignal[]; warnings: ConfidenceSignal[] } {
  const T = CONFIDENCE_THRESHOLDS;
  const has = (id: string) => ctx.penaltyContribs.some((p) => p.id === id);
  const signals: ConfidenceSignal[] = [];
  const warnings: ConfidenceSignal[] = [];

  if (ctx.confidence >= T.veryHigh) signals.push(sig('CONF_STRONG', 'High-confidence market state.', 'strong'));
  if (ctx.agrConf >= T.high) signals.push(sig('CONF_HIGH_AGREEMENT', 'Agreement is directionally strong.', 'info'));
  if (ctx.catConf >= T.high) signals.push(sig('CONF_HIGH_CATEGORY_CONFIDENCE', 'Categories are confident.', 'info'));
  if (ctx.indConf >= T.high) signals.push(sig('CONF_HIGH_INDICATOR_CONFIDENCE', 'Indicators are confident.', 'info'));
  if (ctx.completeness >= 0.9) signals.push(sig('CONF_COMPLETE_EVIDENCE', 'Full evidence base.', 'info'));

  if (has('conflict')) warnings.push(sig('CONF_HIGH_CONFLICT', 'Directional conflict reduces trust.', 'warning'));
  const weak = ctx.penaltyContribs.find((p) => p.id.startsWith('weak_pillar'));
  if (weak) warnings.push(sig('CONF_WEAK_PILLAR', `Confidence limited by its weakest pillar (${weak.id.split(':')[1]}).`, 'warning'));
  if (has('low_quality')) warnings.push(sig('CONF_LOW_QUALITY', 'Weak trend quality reduces trust.', 'warning'));
  if (has('high_volatility')) warnings.push(sig('CONF_HIGH_VOLATILITY', 'High volatility reduces trust.', 'warning'));
  if (has('layer_mismatch')) warnings.push(sig('CONF_LAYER_MISMATCH', 'Indicators and categories disagree.', 'warning'));
  if (ctx.completeness < 0.5) warnings.push(sig('CONF_INSUFFICIENT_EVIDENCE', 'Insufficient evidence base.', 'warning'));

  for (const c of ctx.categories) {
    const f = CATEGORY_CONFIDENCE_FACTORS[c.id];
    if (!f) continue;
    if ((f.minConfidence != null && c.confidence < f.minConfidence) || (f.minStrength != null && c.strength < f.minStrength)) {
      warnings.push(sig('CONF_WEAK_CATEGORY', `${c.id} is below its configured confidence threshold.`, 'warning'));
    }
  }

  if (ctx.raw > 100) warnings.push(sig('CONF_CLAMPED_HIGH', 'Raw confidence exceeded 100 and was clamped.', 'info'));
  if (ctx.raw < 0) warnings.push(sig('CONF_CLAMPED_LOW', 'Raw confidence fell below 0 and was clamped.', 'info'));

  return { signals, warnings };
}
