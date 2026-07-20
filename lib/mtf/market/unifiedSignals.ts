// M8 — Unified signal feed. Merges the frozen layers' signals/warnings into one
// source-tagged, deduplicated, severity-sorted feed (M3–M7 + M8's own notes).
// M2 category signals are NOT included — they are not part of the five-input
// contract; they surface transitively via M3 contributors. Spec §Unified signals.

import type { AgreementResult } from '../agreement/agreementTypes';
import type { ConfidenceResult } from '../confidence/confidenceTypes';
import type { HierarchyResult } from '../timeframe/timeframeTypes';
import type { TrendLifecycleResult } from '../lifecycle/lifecycleTypes';
import type { ProbabilityResult } from '../probability/probabilityTypes';
import type { LayerTag, UnifiedSignal } from './marketTypes';

interface RawSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong' }
const SEVERITY_RANK: Record<RawSignal['severity'], number> = { strong: 0, warning: 1, info: 2 };

function merge(sources: Array<[LayerTag, RawSignal[]]>): UnifiedSignal[] {
  const seen = new Set<string>();
  const out: UnifiedSignal[] = [];
  for (const [source, list] of sources) {
    for (const s of list) {
      if (seen.has(s.code)) continue;   // first occurrence wins (lower layers first)
      seen.add(s.code);
      out.push({ code: s.code, message: s.message, severity: s.severity, source });
    }
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function unifySignals(
  agreement: AgreementResult,
  confidence: ConfidenceResult,
  hierarchy: HierarchyResult,
  lifecycle: TrendLifecycleResult,
  probability: ProbabilityResult,
  m8Own: UnifiedSignal[],
): { signals: UnifiedSignal[]; warnings: UnifiedSignal[] } {
  return {
    signals: merge([
      ['M3', agreement.signals], ['M4', confidence.signals], ['M5', hierarchy.signals],
      ['M6', lifecycle.signals], ['M7', probability.signals], ['M8', m8Own],
    ]),
    warnings: merge([
      ['M3', agreement.warnings], ['M4', confidence.warnings], ['M5', hierarchy.warnings],
      ['M6', lifecycle.warnings], ['M7', probability.warnings],
    ]),
  };
}
