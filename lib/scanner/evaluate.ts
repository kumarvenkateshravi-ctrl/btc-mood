// Technical Scanner — Expression Engine funnel. EVERYTHING evaluates through
// here (Rule 1: closed bars only — callers pass closed candles; the funnel
// never sees the forming bar). Sprint 1 ships condition-level evaluation +
// a single-group AND/OR funnel; the full nested tree with cross-TF index
// mapping lands in Sprint 2 behind the SAME signature.

import type { Candle, Timeframe } from '../types';
import { OPERATORS } from './operators';
import { SCANNER_SOURCES } from './registry';
import { getSeries } from './seriesCache';
import type { Condition, ConditionSnapshot, GroupNode, Series } from './types';
import { isCondition } from './types';

const refLabel = (c: Condition): string => {
  const s = SCANNER_SOURCES[c.left.source];
  const params = c.left.params && Object.keys(c.left.params).length
    ? `(${Object.values(c.left.params).join(',')})` : '';
  return `${s?.name ?? c.left.source}${params} ${c.tf}`;
};

const rhsLabel = (c: Condition): string => {
  if (typeof c.right === 'number') return `${OPERATORS[c.op].label} ${c.right}`;
  if (Array.isArray(c.right)) return `${OPERATORS[c.op].label} [${c.right[0]}, ${c.right[1]}]`;
  const s = SCANNER_SOURCES[c.right.source];
  return `${OPERATORS[c.op].label} ${s?.name ?? c.right.source}`;
};

/** Per-bar boolean series for one condition on ITS OWN timeframe's candles. */
export function evaluateCondition(cond: Condition, candles: Candle[]): (boolean | null)[] {
  const op = OPERATORS[cond.op];
  if (!op) return new Array(candles.length).fill(null);
  const left = getSeries(cond.left, cond.tf, candles);
  const right: Series | number | [number, number] =
    typeof cond.right === 'number' || Array.isArray(cond.right)
      ? cond.right
      : getSeries(cond.right, cond.tf, candles);
  return Array.from({ length: candles.length }, (_, i) => op.evaluate(left, right, i));
}

/** Explainability snapshot of one condition at bar i ("Why?"). */
export function snapshotCondition(cond: Condition, candles: Candle[], i: number): ConditionSnapshot {
  const left = getSeries(cond.left, cond.tf, candles);
  const pass = OPERATORS[cond.op]?.evaluate(
    left,
    typeof cond.right === 'number' || Array.isArray(cond.right)
      ? cond.right
      : getSeries(cond.right, cond.tf, candles),
    i,
  ) === true;
  return { label: refLabel(cond), value: left[i] ?? null, expect: rhsLabel(cond), pass };
}

/**
 * Sprint-1 funnel (interface frozen): evaluates a group whose conditions all
 * share one timeframe. Returns the per-bar match series on that timeframe.
 * Sprint 2 replaces the body with the full nested cross-TF tree — the
 * signature stays.
 */
export function evaluate(
  tree: GroupNode,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): (boolean | null)[] {
  const conditions = tree.children.filter(isCondition);
  if (conditions.length === 0) return [];
  const tf = conditions[0].tf;
  const candles = candlesByTf[tf] ?? [];
  const perCond = conditions
    .filter((c) => c.tf === tf) // S1 limitation; S2 lifts it
    .map((c) => evaluateCondition(c, candles));
  return Array.from({ length: candles.length }, (_, i) => {
    let any = false;
    let allKnown = true;
    for (const s of perCond) {
      const v = s[i];
      if (v == null) { allKnown = false; continue; }
      if (v) any = true;
      else if (tree.logic === 'AND') return false;
    }
    if (!allKnown) return null;      // warm-up: unknown, never a false trigger
    return tree.logic === 'AND' ? true : any;
  });
}
