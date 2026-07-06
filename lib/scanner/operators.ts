// Technical Scanner — Operator Registry: every operator carries metadata,
// operand validation, and its evaluator. Adding an operator = one entry here;
// the builder UI, validator, and expression engine all read this registry.
// Evaluation is null-safe: any missing (warm-up) input yields null, never a
// false trigger.

import type { OperandKind, OperatorId, Series } from './types';

export interface OperatorDef {
  id: OperatorId;
  label: string;
  /** Which right-operand kinds this operator accepts (validation). */
  rhs: OperandKind[];
  /** Extra bars of history required beyond the series' own warm-up. */
  lookback: number;
  evaluate(left: Series, right: Series | number | [number, number], i: number): boolean | null;
}

const rhsAt = (right: Series | number | [number, number], i: number): number | null => {
  if (typeof right === 'number') return right;
  if (Array.isArray(right) && right.length === 2 && typeof right[0] === 'number' && typeof right[1] === 'number' && !Array.isArray(right[0])) {
    return null; // ranges are handled only by `between`
  }
  return (right as Series)[i] ?? null;
};

const cmp = (id: OperatorId, label: string, ok: (l: number, r: number) => boolean): OperatorDef => ({
  id, label, rhs: ['series', 'number'], lookback: 0,
  evaluate(left, right, i) {
    const l = left[i];
    const r = rhsAt(right, i);
    return l == null || r == null ? null : ok(l, r);
  },
});

const cross = (id: OperatorId, label: string, above: boolean): OperatorDef => ({
  id, label, rhs: ['series', 'number'], lookback: 1,
  evaluate(left, right, i) {
    if (i < 1) return null;
    const l = left[i], lp = left[i - 1];
    const r = rhsAt(right, i), rp = rhsAt(right, i - 1);
    if (l == null || lp == null || r == null || rp == null) return null;
    return above ? l > r && lp <= rp : l < r && lp >= rp;
  },
});

const mono = (id: OperatorId, label: string, up: boolean): OperatorDef => ({
  id, label, rhs: [], lookback: 2, // unary: strictly monotonic over the last 3 values
  evaluate(left, _right, i) {
    if (i < 2) return null;
    const a = left[i - 2], b = left[i - 1], c = left[i];
    if (a == null || b == null || c == null) return null;
    return up ? c > b && b > a : c < b && b < a;
  },
});

export const OPERATORS: Record<OperatorId, OperatorDef> = {
  gt: cmp('gt', '>', (l, r) => l > r),
  lt: cmp('lt', '<', (l, r) => l < r),
  gte: cmp('gte', '≥', (l, r) => l >= r),
  lte: cmp('lte', '≤', (l, r) => l <= r),
  between: {
    id: 'between', label: 'between', rhs: ['range'], lookback: 0,
    evaluate(left, right, i) {
      const l = left[i];
      if (l == null || !Array.isArray(right)) return null;
      const [lo, hi] = right as [number, number];
      return l >= Math.min(lo, hi) && l <= Math.max(lo, hi);
    },
  },
  crossAbove: cross('crossAbove', 'crosses above', true),
  crossBelow: cross('crossBelow', 'crosses below', false),
  increasing: mono('increasing', 'increasing', true),
  decreasing: mono('decreasing', 'decreasing', false),
};

export const ALL_OPERATORS = Object.keys(OPERATORS) as OperatorId[];
/** The common comparison set most sources support. */
export const CMP_OPS: OperatorId[] = ['gt', 'lt', 'gte', 'lte', 'between', 'crossAbove', 'crossBelow', 'increasing', 'decreasing'];
