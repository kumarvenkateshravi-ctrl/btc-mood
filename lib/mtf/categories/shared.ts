// M2 — shared category helpers. Defensive reads of M1 diagnostics, vote math,
// and the no-evidence rule. Pure utilities; no category logic.
// Spec: docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md

import type { IndicatorResult } from '../intelligence';
import { clamp, conv } from '../indicators/shared';

export { clamp, conv };

export type IndicatorMap = Partial<Record<string, IndicatorResult>>;

/** Build an id→result map from the M1 registry output. */
export function toMap(indicators: IndicatorResult[]): IndicatorMap {
  const m: IndicatorMap = {};
  for (const r of indicators) m[r.id] = r;
  return m;
}

/** Defensive numeric read of an M1 diagnostic dim; fallback when absent/non-finite. */
export function dim(map: IndicatorMap, id: string, key: string, fallback: number): number {
  const v = (map[id]?.diagnostics as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Directional value → vote: +1 (>55) / −1 (<45) / 0 (boundaries neutral). */
export function voteOf(x: number): -1 | 0 | 1 {
  return x > 55 ? 1 : x < 45 ? -1 : 0;
}

/** |Σ votes| / n · 100, rounded (0 when n = 0). */
export function voteAgreement(votes: number[]): number {
  if (votes.length === 0) return 0;
  const sum = votes.reduce((s, v) => s + v, 0);
  return Math.round((Math.abs(sum) / votes.length) * 100);
}

/** No-evidence rule: all directionals exactly 50 and all magnitudes exactly 0. */
export function noEvidence(directionals: number[], magnitudes: number[]): boolean {
  return directionals.every((d) => d === 50) && magnitudes.every((m) => m === 0);
}

/** Mean of numbers; empty → 50 (neutral). */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 50;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
