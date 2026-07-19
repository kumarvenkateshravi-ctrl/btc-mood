// M6 — Progression engine. Compares the previous and current stage's position in
// the canonical cycle to report the trend's TRAJECTORY (advancing/stalling/
// regressing). 'range' is off-cycle (index -1) — dropping into range from a
// trending stage regresses; emerging from range into an early stage advances.
// Spec §Progression engine.

import { CYCLE_ORDER } from './config';
import type { TrendStage } from './lifecycleTypes';

const indexOf = (stage: TrendStage): number => CYCLE_ORDER.indexOf(stage); // 'range' -> -1

export function progress(
  previous: TrendStage | null,
  current: TrendStage,
): { previous: TrendStage | null; current: TrendStage; trajectory: 'advancing' | 'stalling' | 'regressing' } {
  if (previous === null) return { previous, current, trajectory: 'advancing' };
  const p = indexOf(previous), c = indexOf(current);
  const trajectory = c > p ? 'advancing' : c === p ? 'stalling' : 'regressing';
  return { previous, current, trajectory };
}
