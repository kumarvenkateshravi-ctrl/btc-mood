// M3 — Explanation. Pattern-based, generic: signal CODES are fixed, but any
// component named in a message is interpolated from contributor `id`s (never
// hardcoded). Dissenters are contributors voting the opposite directional side to
// the dominant bias. Spec §Explanation.

import type { Verdict } from '../types';
import type {
  AgreementSignal, AgreementState, Contributor, ContributorLayer, LayerAgreement,
} from './agreementTypes';

export interface ExplainContext {
  agreement: number;
  conflict: number;
  dominantBias: Verdict;
  state: AgreementState;
  dominantShare: number;
  minorityShare: number;
  ind: LayerAgreement;
  cat: LayerAgreement;
  contributors: Contributor[];
  thresholds: { highConflict: number; oneSided: number; lowDirection: number };
}

const isDir = (v: Verdict): boolean => v === 'bullish' || v === 'bearish';
const opposite = (v: Verdict): Verdict => (v === 'bullish' ? 'bearish' : v === 'bearish' ? 'bullish' : 'neutral');

const sig = (code: string, message: string, severity: AgreementSignal['severity'], source: ContributorLayer): AgreementSignal =>
  ({ code, message, severity, source });

export function explain(ctx: ExplainContext): { signals: AgreementSignal[]; warnings: AgreementSignal[] } {
  const { agreement, conflict, dominantBias, state, dominantShare, minorityShare, ind, cat, contributors, thresholds } = ctx;
  const strongestLayer: ContributorLayer = ind.agreement >= cat.agreement ? 'indicator' : 'category';
  const dir = isDir(dominantBias);

  const signals: AgreementSignal[] = [];
  if (agreement >= 75 && dir)
    signals.push(sig('AGR_STRONG_CONSENSUS', `Strong ${dominantBias} consensus across indicators and categories.`, 'strong', strongestLayer));
  if (isDir(ind.dominantBias) && ind.dominantBias === cat.dominantBias)
    signals.push(sig('AGR_LAYERS_ALIGNED', `Indicators and categories agree (${ind.dominantBias}).`, 'info', 'category'));
  if (dominantShare >= thresholds.oneSided)
    signals.push(sig('AGR_ONE_SIDED', 'One-sided positioning.', 'strong', strongestLayer));
  if (dominantBias === 'neutral' && agreement >= 75)
    signals.push(sig('AGR_NEUTRAL_DOMINANCE', 'Strong neutral consensus.', 'info', 'category'));

  const warnings: AgreementSignal[] = [];
  if (conflict >= thresholds.highConflict)
    warnings.push(sig('AGR_HIGH_CONFLICT', 'Directional votes are evenly split.', 'warning', 'category'));
  if (isDir(ind.dominantBias) && isDir(cat.dominantBias) && ind.dominantBias !== cat.dominantBias)
    warnings.push(sig('AGR_LAYER_MISMATCH', `Indicators and categories disagree (${ind.dominantBias} vs ${cat.dominantBias}).`, 'warning', 'category'));

  if (dir) {
    const dissenters = contributors.filter((c) => c.vote === opposite(dominantBias));
    if (dissenters.length > 0) {
      const source: ContributorLayer = dissenters.some((d) => d.layer === 'indicator') ? 'indicator' : 'category';
      warnings.push(sig('AGR_DISSENT', `${dissenters.map((d) => d.id).join(', ')} diverge from the ${dominantBias} consensus.`, 'warning', source));
    }
  }
  if (state !== 'none' && dominantShare + minorityShare < thresholds.lowDirection)
    warnings.push(sig('AGR_LOW_DIRECTION', 'Little directional conviction.', 'warning', 'category'));

  return { signals, warnings };
}
