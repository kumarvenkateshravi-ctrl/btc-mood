// M5 — Timeframe Hierarchy engine. Reuses the frozen M3 vote primitive with TFs
// as weighted voters, then derives per-TF authority and the controlling timeframe
// (hybrid: HTF-weighted vote + authority threshold + top-down transfer).
// overallMarketState/transition/explanation are completed by hierarchyState.ts.
// Spec §Timeframe Hierarchy engine.

import type { Timeframe } from '../../types';
import type { Voter } from '../agreement/agreementTypes';
import { agreementFrom, dominanceFrom, tally } from '../agreement/vote';
import { conflictFrom } from '../agreement/conflict';
import type { HierarchyResult, TimeframeContributor, TimeframeEntry, TimeframeSnapshot } from './timeframeTypes';
import { AUTHORITY, TIMEFRAME_HIERARCHY, tfRole, tfWeight } from './config';
import { deriveMarketState } from './hierarchyState';

export function authorityOf(confidence: number, regimeClarity: number): number {
  return Math.round(AUTHORITY.confidenceWeight * confidence + AUTHORITY.clarityWeight * regimeClarity);
}

export function computeTimeframeHierarchy(snapshots: TimeframeSnapshot[]): HierarchyResult {
  const ordered = [...snapshots].sort((a, b) => tfWeight(b.timeframe) - tfWeight(a.timeframe));

  if (ordered.length === 0) {
    return {
      schemaVersion: 1, htfBias: 'neutral', alignment: 0, conflict: 0,
      controller: TIMEFRAME_HIERARCHY[0], controllerAuthority: 0,
      overallMarketState: 'range_bound', transition: false,
      perTimeframe: {}, contributors: [], signals: [], warnings: [],
    };
  }

  // --- M3 vote over timeframes (TFs are Voters, weighted by hierarchy position) ---
  const voters: Voter[] = ordered.map((s) => ({ id: s.timeframe, verdict: s.bias, confidence: s.confidence, weight: tfWeight(s.timeframe) }));
  const t = tally(voters);
  const alignment = agreementFrom(t);
  const htfBias = dominanceFrom(t);
  const conflict = conflictFrom(t.bull, t.bear, t.total);

  // --- intrinsic authority + controller (top-down with transfer) ---
  const authorityByTf = new Map<Timeframe, number>(ordered.map((s) => [s.timeframe, authorityOf(s.confidence, s.regimeClarity)]));
  const present = new Set(ordered.map((s) => s.timeframe));
  let controller: Timeframe | undefined;
  for (const tf of TIMEFRAME_HIERARCHY) {
    if (present.has(tf) && (authorityByTf.get(tf) ?? 0) >= AUTHORITY.threshold) { controller = tf; break; }
  }
  if (!controller) {
    controller = ordered.reduce((best, s) => {
      const a = authorityByTf.get(s.timeframe)!, b = authorityByTf.get(best.timeframe)!;
      return a > b || (a === b && tfWeight(s.timeframe) > tfWeight(best.timeframe)) ? s : best;
    }, ordered[0]).timeframe;
  }
  const controllerBias = ordered.find((s) => s.timeframe === controller)!.bias;

  // --- per-TF entries + contributors ---
  const perTimeframe: Partial<Record<Timeframe, TimeframeEntry>> = {};
  const contributors: TimeframeContributor[] = [];
  for (const s of ordered) {
    const authority = authorityByTf.get(s.timeframe)!;
    perTimeframe[s.timeframe] = {
      timeframe: s.timeframe, bias: s.bias, confidence: s.confidence,
      regime: s.regime, regimeClarity: s.regimeClarity, role: tfRole(s.timeframe),
      authority, agreesWithHTF: s.bias === controllerBias,
    };
    contributors.push({ timeframe: s.timeframe, bias: s.bias, confidence: s.confidence, weight: tfWeight(s.timeframe), authority });
  }

  const base: HierarchyResult = {
    schemaVersion: 1, htfBias, alignment, conflict,
    controller, controllerAuthority: authorityByTf.get(controller)!,
    overallMarketState: 'range_bound', transition: false,
    perTimeframe, contributors, signals: [], warnings: [],
  };
  return deriveMarketState(base, ordered);
}
