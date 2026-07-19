// M3 — Conflict. Independent of agreement (NOT 100 − agreement): measures how
// evenly the two directional sides are split, scaled by how much of the vote is
// directional at all. Spec §Conflict.

import { clamp } from '../indicators/shared';

/** Conflict 0–100 from weighted bull/bear masses and the total (incl. neutral). */
export function conflictFrom(bull: number, bear: number, total: number): number {
  const dir = bull + bear;
  if (dir <= 0 || total <= 0) return 0;
  const balance = 1 - Math.abs(bull - bear) / dir; // 0 one-sided … 1 evenly split
  const dirShare = dir / total;                    // scale down when mostly neutral
  return Math.round(clamp(balance * dirShare * 100, 0, 100));
}
