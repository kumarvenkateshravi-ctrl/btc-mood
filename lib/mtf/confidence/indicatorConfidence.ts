// M4 — Indicator confidence pillar. Weight-weighted mean of indicator confidences.
// Generic: reads only public Voter-ish properties. Spec §Pillars.

import type { IndicatorResult } from '../intelligence';

/** Σ(weight·confidence) / Σ(weight), rounded; empty → 0. */
export function indicatorConfidence(indicators: IndicatorResult[]): number {
  let sum = 0, wSum = 0;
  for (const r of indicators) {
    const w = r.weight;
    sum += w * r.confidence;
    wSum += w;
  }
  return wSum > 0 ? Math.round(sum / wSum) : 0;
}
