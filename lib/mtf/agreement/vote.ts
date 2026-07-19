// M3 — the generic vote primitive. Never names an indicator or category: it only
// counts voters by verdict, weighted by (weight ?? 1) × confidence. Spec §Shared
// primitives / §Layer engines.

import type { Verdict } from '../types';
import { clamp } from '../indicators/shared';
import { conflictFrom } from './conflict';
import type { Contributor, ContributorLayer, LayerAgreement, Voter } from './agreementTypes';

export interface Tally {
  bull: number; bear: number; neutral: number; total: number;
  bullFrac: number; bearFrac: number; neutralFrac: number;
}

/** Weighted masses per verdict bucket; fractions normalized (total 0 → all 0). */
export function tally(voters: Voter[]): Tally {
  let bull = 0, bear = 0, neutral = 0;
  for (const v of voters) {
    const w = (v.weight ?? 1) * v.confidence;
    if (v.verdict === 'bullish') bull += w;
    else if (v.verdict === 'bearish') bear += w;
    else neutral += w;
  }
  const total = bull + bear + neutral;
  const f = (x: number) => (total > 0 ? x / total : 0);
  return { bull, bear, neutral, total, bullFrac: f(bull), bearFrac: f(bear), neutralFrac: f(neutral) };
}

/** Dominant bucket's share of the total, 0–100 (neutral is in the denominator). */
export function agreementFrom(t: Tally): number {
  if (t.total <= 0) return 0;
  return Math.round(clamp((Math.max(t.bull, t.bear, t.neutral) / t.total) * 100, 0, 100));
}

/** Verdict of the largest bucket; ties and neutral-max resolve to neutral. */
export function dominanceFrom(t: { bull: number; bear: number; neutral: number }): Verdict {
  if (t.bull > t.bear && t.bull >= t.neutral) return 'bullish';
  if (t.bear > t.bull && t.bear >= t.neutral) return 'bearish';
  return 'neutral';
}

/** Trace each voter to a contributor with its effective tally weight. */
export function contributorsOf(voters: Voter[], layer: ContributorLayer): Contributor[] {
  return voters.map((v) => ({ id: v.id, layer, vote: v.verdict, weight: (v.weight ?? 1) * v.confidence }));
}

/** Assemble a full per-layer result from a list of generic voters. */
export function layerAgreementOf(voters: Voter[], layer: ContributorLayer): LayerAgreement {
  const t = tally(voters);
  return {
    agreement: agreementFrom(t),
    conflict: conflictFrom(t.bull, t.bear, t.total),
    dominantBias: dominanceFrom(t),
    bull: t.bull, bear: t.bear, neutral: t.neutral, total: t.total,
    bullFrac: t.bullFrac, bearFrac: t.bearFrac, neutralFrac: t.neutralFrac,
    contributors: contributorsOf(voters, layer),
  };
}
