// M3 — Combined dominance. dominantBias comes from the COMBINED weighted vote
// across both layers (renormalized when a layer is empty), never by blending the
// two layers' independent winners. Spec §Combined dominance.

import type { Verdict } from '../types';
import type { LayerAgreement } from './agreementTypes';
import { dominanceFrom } from './vote';

export interface CombinedVote {
  dominantBias: Verdict;
  bull: number; bear: number; neutral: number; // combined normalized masses (sum ≈ 1)
  dominantShare: number;                        // larger directional side, 0–1
  minorityShare: number;                        // smaller directional side, 0–1
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function combine(
  ind: LayerAgreement,
  cat: LayerAgreement,
  blend: { indicator: number; category: number },
): CombinedVote {
  let wi = ind.total > 0 ? blend.indicator : 0;
  let wc = cat.total > 0 ? blend.category : 0;
  if (wi + wc === 0) return { dominantBias: 'neutral', bull: 0, bear: 0, neutral: 0, dominantShare: 0, minorityShare: 0 };
  const s = wi + wc;
  wi /= s; wc /= s;

  const bull = wi * ind.bullFrac + wc * cat.bullFrac;
  const bear = wi * ind.bearFrac + wc * cat.bearFrac;
  const neutral = wi * ind.neutralFrac + wc * cat.neutralFrac;

  return {
    dominantBias: dominanceFrom({ bull, bear, neutral }),
    bull, bear, neutral,
    dominantShare: round2(Math.max(bull, bear)),
    minorityShare: round2(Math.min(bull, bear)),
  };
}
