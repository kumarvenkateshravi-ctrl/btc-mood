// M5 — overallMarketState + transition + hierarchy explanation. The cross-TF
// composite headline (continuation/pullback/transition/reversal_risk/range/…):
// requires comparing HTF context vs LTF trigger, which only the hierarchy has.
// Spec §Timeframe Hierarchy engine (steps 5–7).

import type { Verdict } from '../types';
import { dominanceFrom, tally } from '../agreement/vote';
import type {
  HierarchyResult, OverallMarketState, TimeframeEntry, TimeframeRole, TimeframeSignal, TimeframeSnapshot,
} from './timeframeTypes';
import { HIERARCHY_THRESHOLDS, tfRole, tfWeight } from './config';

const isDir = (v: Verdict): boolean => v === 'bullish' || v === 'bearish';
const opposite = (v: Verdict): Verdict => (v === 'bullish' ? 'bearish' : v === 'bearish' ? 'bullish' : 'neutral');

/** Weighted-dominant bias of the TFs in one tier. */
function tierBias(ordered: TimeframeSnapshot[], role: TimeframeRole): Verdict {
  const voters = ordered
    .filter((s) => tfRole(s.timeframe) === role)
    .map((s) => ({ id: s.timeframe, verdict: s.bias, confidence: s.confidence, weight: tfWeight(s.timeframe) }));
  if (voters.length === 0) return 'neutral';
  return dominanceFrom(tally(voters));
}

export function deriveMarketState(base: HierarchyResult, ordered: TimeframeSnapshot[]): HierarchyResult {
  const entries = Object.values(base.perTimeframe).filter((e): e is TimeframeEntry => !!e);
  const contextAuthorities = entries.filter((e) => e.role === 'context').map((e) => e.authority);
  const contextStrong = (contextAuthorities.length ? Math.max(...contextAuthorities) : base.controllerAuthority) >= HIERARCHY_THRESHOLDS.contextStrong;

  const contextBias = tierBias(ordered, 'context');
  const triggerBias = tierBias(ordered, 'trigger');
  const controllerRegime = base.perTimeframe[base.controller]?.regime;

  // --- overallMarketState ---
  let overallMarketState: OverallMarketState;
  if (!isDir(base.htfBias)) {
    overallMarketState = controllerRegime === 'compression' ? 'compression'
      : controllerRegime === 'expansion' ? 'expansion' : 'range_bound';
  } else {
    const dir = base.htfBias === 'bullish' ? 'bullish' : 'bearish';
    if (triggerBias === base.htfBias) overallMarketState = `${dir}_continuation` as OverallMarketState;
    else if (triggerBias === opposite(base.htfBias)) overallMarketState = (contextStrong ? `${dir}_pullback` : 'reversal_risk') as OverallMarketState;
    else overallMarketState = `${dir}_transition` as OverallMarketState;
  }

  const transition = (isDir(contextBias) && isDir(triggerBias) && contextBias !== triggerBias)
    || base.conflict >= HIERARCHY_THRESHOLDS.highConflict;

  // --- explanation (generic codes, ids interpolated from data) ---
  const signals: TimeframeSignal[] = [];
  const warnings: TimeframeSignal[] = [];
  if (base.alignment >= HIERARCHY_THRESHOLDS.aligned && isDir(base.htfBias))
    signals.push({ code: 'TF_STACK_ALIGNED', message: `Timeframes aligned ${base.htfBias}.`, severity: 'strong' });
  signals.push({ code: 'TF_CONTROLLER', message: `${base.controller} controls (${base.htfBias}).`, severity: 'info' });
  if (contextStrong) signals.push({ code: 'TF_STRONG_CONTEXT', message: 'Higher-timeframe context is strong.', severity: 'info' });

  if (base.conflict >= HIERARCHY_THRESHOLDS.highConflict)
    warnings.push({ code: 'TF_STACK_CONFLICT', message: 'Timeframes conflict.', severity: 'warning' });
  const topPresent = ordered[0]?.timeframe;
  if (topPresent && base.controller !== topPresent)
    warnings.push({ code: 'TF_CONTROL_TRANSFER', message: `Control transferred from ${topPresent} to ${base.controller}.`, severity: 'warning' });
  for (const e of entries)
    if (e.role === 'trigger' && !e.agreesWithHTF && isDir(base.htfBias))
      warnings.push({ code: 'TF_LTF_DIVERGENCE', message: `${e.timeframe} diverges from ${base.controller}.`, severity: 'warning' });
  if (overallMarketState === 'reversal_risk')
    warnings.push({ code: 'TF_REVERSAL_RISK', message: 'Reversal risk: lower timeframes oppose a weakening context.', severity: 'warning' });

  return { ...base, overallMarketState, transition, signals, warnings };
}
