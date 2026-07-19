// M5 — overallMarketState + transition + explanation (completed in Task 4).
// Task 3 ships a passthrough so the hierarchy core is releasable on its own.

import type { HierarchyResult, TimeframeSnapshot } from './timeframeTypes';

export function deriveMarketState(base: HierarchyResult, _ordered: TimeframeSnapshot[]): HierarchyResult {
  return base;
}
