// Technical Scanner — Expression Engine (Sprint 2: full nested tree +
// per-condition cross-TF mapping). EVERYTHING evaluates through here.
//
// Rule 1 (deterministic, non-repainting): callers pass CLOSED candles; a
// condition on timeframe T', evaluated at an eval-TF bar close, reads the
// last T' bar whose CLOSE TIME is ≤ the eval bar's close time — so a value
// is only ever visible once its own bar has closed. Prefix invariance is
// locked by test: evaluating a truncated history never changes past results.
//
// Three-valued logic (Kleene): warm-up/unknown = null. AND: any false → false,
// else any null → null. OR: any true → true, else any null → null. A null can
// therefore never fire a signal.

import type { Candle, Timeframe } from '../types';
import { OPERATORS } from './operators';
import { SCANNER_SOURCES } from './registry';
import { getSeries } from './seriesCache';
import type { Condition, ConditionSnapshot, GroupNode, Series } from './types';
import { isCondition } from './types';

export const TF_SECONDS: Record<Timeframe, number> = {
  '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
};

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

/** Explainability snapshot of one condition at bar i of ITS OWN timeframe. */
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
 * For each eval-TF bar, the index of the last target-TF bar whose close time
 * ≤ the eval bar's close time (−1 while none). Candle `time` = bar OPEN time.
 * Two-pointer O(n+m); inherently non-repainting.
 */
export function mapTfIndices(
  evalCandles: Candle[], evalTf: Timeframe,
  targetCandles: Candle[], targetTf: Timeframe,
): number[] {
  const evalDur = TF_SECONDS[evalTf];
  const tgtDur = TF_SECONDS[targetTf];
  const out = new Array<number>(evalCandles.length).fill(-1);
  let j = -1;
  for (let i = 0; i < evalCandles.length; i++) {
    const closeAt = evalCandles[i].time + evalDur;
    while (j + 1 < targetCandles.length && targetCandles[j + 1].time + tgtDur <= closeAt) j++;
    out[i] = j;
  }
  return out;
}

interface PreparedCondition {
  bools: (boolean | null)[];  // on the condition's own TF
  map: number[] | null;       // evalTf bar → own-TF index (null = same TF)
  cond: Condition;
  ownCandles: Candle[];
}

function collectConditions(node: GroupNode, out: Condition[] = []): Condition[] {
  for (const child of node.children) {
    if (isCondition(child)) out.push(child);
    else collectConditions(child, out);
  }
  return out;
}

function prepare(
  tree: GroupNode,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): Map<Condition, PreparedCondition> {
  const evalCandles = candlesByTf[evalTf] ?? [];
  const prepared = new Map<Condition, PreparedCondition>();
  for (const cond of collectConditions(tree)) {
    const ownCandles = candlesByTf[cond.tf] ?? [];
    prepared.set(cond, {
      cond,
      ownCandles,
      bools: evaluateCondition(cond, ownCandles),
      map: cond.tf === evalTf ? null : mapTfIndices(evalCandles, evalTf, ownCandles, cond.tf),
    });
  }
  return prepared;
}

function evalNode(
  node: GroupNode,
  prepared: Map<Condition, PreparedCondition>,
  i: number,
): boolean | null {
  let sawNull = false;
  let sawTrue = false;
  for (const child of node.children) {
    let v: boolean | null;
    if (isCondition(child)) {
      const p = prepared.get(child)!;
      const idx = p.map ? p.map[i] : i;
      v = idx >= 0 ? p.bools[idx] ?? null : null;
    } else {
      v = evalNode(child, prepared, i);
    }
    if (v === false && node.logic === 'AND') return false;
    if (v === true && node.logic === 'OR') return true;
    if (v == null) sawNull = true;
    if (v === true) sawTrue = true;
  }
  if (node.children.length === 0) return null; // empty group is never a match
  if (sawNull) return null;
  return node.logic === 'AND' ? true : sawTrue;
}

/**
 * THE funnel: per-eval-TF-bar match series for a full nested tree, each
 * condition read on its own timeframe. `evalTf` defaults to the first
 * condition's timeframe.
 */
export function evaluate(
  tree: GroupNode,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf?: Timeframe,
): (boolean | null)[] {
  const conditions = collectConditions(tree);
  if (conditions.length === 0) return [];
  const tf = evalTf ?? conditions[0].tf;
  const evalCandles = candlesByTf[tf] ?? [];
  const prepared = prepare(tree, candlesByTf, tf);
  return Array.from({ length: evalCandles.length }, (_, i) => evalNode(tree, prepared, i));
}

/** "Why?" — per-condition snapshots for one eval-TF bar (stored on signals). */
export function explainAt(
  tree: GroupNode,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
  i: number,
): ConditionSnapshot[] {
  const evalCandles = candlesByTf[evalTf] ?? [];
  return collectConditions(tree).map((cond) => {
    const ownCandles = candlesByTf[cond.tf] ?? [];
    const idx = cond.tf === evalTf ? i : mapTfIndices(evalCandles, evalTf, ownCandles, cond.tf)[i] ?? -1;
    if (idx < 0) return { label: refLabel(cond), value: null, expect: rhsLabel(cond), pass: false };
    return snapshotCondition(cond, ownCandles, idx);
  });
}
