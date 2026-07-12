// Strategy DNA (Strategy Studio M6) — every strategy gets an automatic
// identity computed at save: what kind of trader it suits, what it leans on,
// how risky, how often it fires, how complex. Rendered as the My-Strategies
// card and, later, the marketplace listing. Pure and deterministic.

import type { Condition, GroupNode, StrategyRisk } from './types';
import { isCondition } from './types';
import { SCANNER_SOURCES } from './registry';
import { categoryOf, type SourceCategory } from './sourceCategories';
import { getStyleProfile, TRADER_STYLES, type TraderStyleId } from './styleProfiles';
import { lintStrategy } from './lint';
import { TIMEFRAMES, type Timeframe } from '../types';

export interface StrategyDna {
  style: TraderStyleId;
  styleInferred: boolean;
  direction: 'long' | 'short';
  /** Dominant condition categories, most-used first (up to 3). */
  emphasis: SourceCategory[];
  usesSmc: boolean;
  riskProfile: 'low' | 'medium' | 'high';
  /** Expected holding, human phrase (from the style cadence). */
  holding: string;
  expectedFrequency: string;
  complexity: 'simple' | 'intermediate' | 'advanced';
  /** 0-100 institutional grade (from the lint). */
  grade: number;
  conditionCount: number;
}

function walk(node: GroupNode, out: Condition[] = []): Condition[] {
  for (const c of node.children) {
    if (isCondition(c)) out.push(c);
    else walk(c, out);
  }
  return out;
}

/** Infer the closest trading style from the conditions' primary timeframe. */
function inferStyle(conditions: Condition[]): TraderStyleId {
  if (conditions.length === 0) return 'custom';
  // Fastest timeframe used = the signal TF.
  const fastest = conditions
    .map((c) => TIMEFRAMES.indexOf(c.tf))
    .reduce((a, b) => Math.min(a, b), TIMEFRAMES.length);
  const signalTf = TIMEFRAMES[fastest] as Timeframe;
  const smc = conditions.some((c) => c.left.source.startsWith('smc_'));
  if (smc) return 'smc';
  // Match the style whose primary ladder TF equals the signal TF.
  const match = TRADER_STYLES.find((s) => s.id !== 'custom' && s.ladder.primary === signalTf);
  return match?.id ?? 'custom';
}

const HOLDING: Record<TraderStyleId, string> = {
  scalper: 'minutes',
  intraday: 'hours (flat by close)',
  swing: 'days',
  position: 'weeks',
  smc: 'hours to days',
  custom: 'varies',
};

export function computeStrategyDna(input: {
  tree: GroupNode;
  direction: 'long' | 'short';
  risk?: StrategyRisk | null;
  style?: TraderStyleId;
}): StrategyDna {
  const conditions = walk(input.tree);
  const styleInferred = !input.style || input.style === 'custom';
  const style = styleInferred ? inferStyle(conditions) : input.style!;
  const profile = getStyleProfile(style);

  // Category emphasis by usage count.
  const counts = new Map<SourceCategory, number>();
  for (const c of conditions) {
    const cat = categoryOf(SCANNER_SOURCES[c.left.source] ?? { id: c.left.source, group: 'standard' });
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const emphasis = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat]) => cat);

  // Risk profile from stop distance + position sizing.
  const slAtr = 1.5; // exits live on the strategy; DNA reads risk sizing here
  const posRisk = input.risk?.positionRiskPct ?? 1;
  const riskProfile: StrategyDna['riskProfile'] =
    posRisk >= 2 || (input.risk?.trailingAtr == null && posRisk >= 1.5) ? 'high' : posRisk <= 0.75 ? 'low' : 'medium';
  void slAtr;

  const complexity: StrategyDna['complexity'] =
    conditions.length <= 2 ? 'simple' : conditions.length <= 5 ? 'intermediate' : 'advanced';

  const grade = lintStrategy({ tree: input.tree, style: styleInferred ? undefined : style }).grade;

  return {
    style,
    styleInferred,
    direction: input.direction,
    emphasis,
    usesSmc: conditions.some((c) => c.left.source.startsWith('smc_')),
    riskProfile,
    holding: HOLDING[style],
    expectedFrequency: profile.cadence.label,
    complexity,
    grade,
    conditionCount: conditions.length,
  };
}
