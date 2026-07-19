// M4 — Penalty engine. ORTHOGONAL reductions only — none represented in the base:
// conflict, cross-layer mismatch, low quality, high volatility, and the weak-pillar
// limiter (a strong result is constrained by its weakest foundational pillar).
// Contributions are negative. Spec §Penalties.

import type { CategoryResult } from '../categoryTypes';
import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceContributor, ConfidenceLayer } from './confidenceTypes';
import { CONFIDENCE_PENALTIES } from './config';

export interface PenaltyContext {
  agreement: AgreementResult;
  categories: CategoryResult[];
  base: number;
  indConf: number;
  catConf: number;
  agrConf: number;
}

export function computePenalties(ctx: PenaltyContext): ConfidenceContributor[] {
  const P = CONFIDENCE_PENALTIES;
  const out: ConfidenceContributor[] = [];
  const push = (id: string, layer: ConfidenceLayer, amount: number) => {
    if (amount > 0) out.push({ id, layer, kind: 'penalty', contribution: -amount });
  };

  push('conflict', 'agreement', Math.round(P.conflict * (ctx.agreement.conflict / 100)));
  push('layer_mismatch', 'agreement', ctx.agreement.warnings.some((w) => w.code === 'AGR_LAYER_MISMATCH') ? P.layerMismatch : 0);

  const quality = ctx.categories.find((c) => c.id === 'quality');
  if (quality) push('low_quality', 'category', Math.round(P.quality * (1 - quality.strength / 100)));

  const volatility = ctx.categories.find((c) => c.id === 'volatility');
  if (volatility) push('high_volatility', 'category', Math.round(P.volatility * (volatility.strength / 100)));

  const pillars: Array<[string, ConfidenceLayer, number]> = [
    ['indicator', 'indicator', ctx.indConf],
    ['category', 'category', ctx.catConf],
    ['agreement', 'agreement', ctx.agrConf],
  ];
  const weakest = pillars.reduce((m, p) => (p[2] < m[2] ? p : m));
  push(`weak_pillar:${weakest[0]}`, weakest[1], Math.round(P.limitingFactor * Math.max(0, ctx.base - weakest[2])));

  return out;
}
