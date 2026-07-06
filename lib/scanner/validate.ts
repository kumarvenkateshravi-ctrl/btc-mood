// Technical Scanner — Validation Engine (Sprint 3). Runs before every save
// AND before evaluation (defense in depth): invalid strategies are
// unrepresentable in the store. Registry-driven — every rule reads source/
// operator metadata, never hardcoded indicator knowledge.
//
// Also produces the ComplexityReport (depth / conditions / groups / estimated
// evaluation cost) that powers the Strategy Inspector (Sprint 6).

import type { Timeframe } from '../types';
import { TIMEFRAMES } from '../types';
import { OPERATORS } from './operators';
import { SCANNER_SOURCES } from './registry';
import type { Condition, GroupNode, ScannerStrategy, SeriesRef } from './types';
import { isCondition } from './types';

export interface ValidationIssue {
  path: string;      // "groups[0].conditions[2]" — for inline UI errors
  code: string;
  message: string;
}

export interface ComplexityReport {
  depth: number;
  conditions: number;
  groups: number;
  timeframes: Timeframe[];
  sources: string[];        // distinct source ids used
  uniqueSeries: number;     // distinct (source, params, output, tf) — cache units
  costUnits: number;        // Σ costWeight over unique series
  cost: 'low' | 'medium' | 'high';
}

export interface ValidationResult {
  ok: boolean;                 // no errors (warnings allowed)
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  complexity: ComplexityReport;
}

export interface ComplexityLimits {
  maxDepth: number;
  maxConditions: number;
  maxGroups: number;
  mediumCostUnits: number; // cost > this → 'medium'
  highCostUnits: number;   // cost > this → 'high'
}

export const DEFAULT_LIMITS: ComplexityLimits = {
  maxDepth: 8,
  maxConditions: 40,
  maxGroups: 12,
  mediumCostUnits: 10,
  highCostUnits: 25,
};

const DEFAULT_COST_WEIGHT = 2;

function checkRef(ref: SeriesRef, path: string, side: 'left' | 'right', errors: ValidationIssue[]): void {
  const source = SCANNER_SOURCES[ref.source];
  if (!source) {
    errors.push({ path, code: 'unknown-source', message: `${side}: unknown source "${ref.source}"` });
    return;
  }
  if (!source.outputs.some((o) => o.id === ref.output)) {
    errors.push({ path, code: 'unknown-output', message: `${side}: "${ref.source}" has no output "${ref.output}"` });
  }
  for (const [k, v] of Object.entries(ref.params ?? {})) {
    const def = source.params.find((p) => p.id === k);
    if (!def) {
      errors.push({ path, code: 'unknown-param', message: `${side}: "${ref.source}" has no parameter "${k}"` });
      continue;
    }
    if (def.type === 'number') {
      const x = typeof v === 'string' ? Number(v) : v;
      if (!Number.isFinite(x)) {
        errors.push({ path, code: 'bad-param', message: `${side}: parameter "${k}" must be a number` });
      } else if ((def.min != null && (x as number) < def.min) || (def.max != null && (x as number) > def.max)) {
        errors.push({ path, code: 'param-out-of-range', message: `${side}: "${k}" = ${x} outside [${def.min ?? '−∞'}, ${def.max ?? '∞'}]` });
      }
    }
  }
}

function checkCondition(cond: Condition, path: string, errors: ValidationIssue[], warnings: ValidationIssue[]): void {
  checkRef(cond.left, path, 'left', errors);
  const source = SCANNER_SOURCES[cond.left.source];
  const op = OPERATORS[cond.op];

  if (!op) {
    errors.push({ path, code: 'unknown-operator', message: `unknown operator "${cond.op}"` });
    return;
  }
  if (source && !source.operators.includes(cond.op)) {
    errors.push({ path, code: 'operator-not-allowed', message: `"${source.name}" does not support "${op.label}"` });
  }

  // Right-operand kind must match the operator's contract.
  const rhs = cond.right;
  const isRange = Array.isArray(rhs);
  const isNumber = typeof rhs === 'number';
  const isSeries = !isRange && !isNumber;
  if (op.rhs.length > 0) {
    const kindOk =
      (isNumber && op.rhs.includes('number')) ||
      (isRange && op.rhs.includes('range')) ||
      (isSeries && op.rhs.includes('series'));
    if (!kindOk) {
      errors.push({ path, code: 'operand-mismatch', message: `"${op.label}" expects ${op.rhs.join(' or ')}` });
    }
  }
  if (isRange) {
    const r = rhs as [number, number];
    if (r.length !== 2 || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) {
      errors.push({ path, code: 'bad-range', message: 'between requires two finite numbers' });
    }
  }
  if (isSeries) checkRef(rhs as SeriesRef, path, 'right', errors);

  // Constant vs the LEFT output's known value range (e.g. RSI > 300).
  const output = source?.outputs.find((o) => o.id === cond.left.output);
  if (output?.range && isNumber) {
    const [lo, hi] = output.range;
    if ((rhs as number) < lo || (rhs as number) > hi) {
      errors.push({ path, code: 'value-out-of-range', message: `${output.label} is bounded [${lo}, ${hi}]; ${rhs} can never match` });
    }
  }

  if (!TIMEFRAMES.includes(cond.tf)) {
    errors.push({ path, code: 'unknown-tf', message: `unknown timeframe "${cond.tf}"` });
  } else if (source && !source.tfs.includes(cond.tf)) {
    errors.push({ path, code: 'unsupported-tf', message: `"${source.name}" does not support ${cond.tf}` });
  }

  if (source?.liveOnly) {
    warnings.push({ path, code: 'live-only', message: `"${source.name}" has no per-bar history — this condition has NO backtest coverage (live signals only)` });
  }
}

const seriesKey = (ref: SeriesRef, tf: Timeframe): string =>
  `${ref.source}|${ref.output}|${JSON.stringify(ref.params ?? {})}|${tf}`;

export function validateTree(
  tree: GroupNode,
  limits: ComplexityLimits = DEFAULT_LIMITS,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const tfs = new Set<Timeframe>();
  const sources = new Set<string>();
  const unique = new Map<string, number>(); // seriesKey → costWeight
  let conditions = 0;
  let groups = 0;
  let maxDepth = 0;

  const walk = (node: GroupNode, path: string, depth: number): void => {
    groups++;
    maxDepth = Math.max(maxDepth, depth);
    if (node.logic !== 'AND' && node.logic !== 'OR') {
      errors.push({ path, code: 'bad-logic', message: `group logic must be AND or OR` });
    }
    if (node.children.length === 0) {
      errors.push({ path, code: 'empty-group', message: 'group has no conditions' });
    }
    node.children.forEach((child, idx) => {
      if (isCondition(child)) {
        conditions++;
        const cpath = `${path}.conditions[${idx}]`;
        checkCondition(child, cpath, errors, warnings);
        tfs.add(child.tf);
        sources.add(child.left.source);
        const w = SCANNER_SOURCES[child.left.source]?.costWeight ?? DEFAULT_COST_WEIGHT;
        unique.set(seriesKey(child.left, child.tf), w);
        if (typeof child.right === 'object' && !Array.isArray(child.right)) {
          sources.add(child.right.source);
          const rw = SCANNER_SOURCES[child.right.source]?.costWeight ?? DEFAULT_COST_WEIGHT;
          unique.set(seriesKey(child.right, child.tf), rw);
        }
      } else {
        walk(child, `${path}.groups[${idx}]`, depth + 1);
      }
    });
  };
  walk(tree, 'root', 1);

  // Complexity limits (protects evaluation performance).
  if (maxDepth > limits.maxDepth) {
    errors.push({ path: 'root', code: 'max-depth', message: `nesting depth ${maxDepth} exceeds ${limits.maxDepth}` });
  }
  if (conditions > limits.maxConditions) {
    errors.push({ path: 'root', code: 'max-conditions', message: `${conditions} conditions exceed ${limits.maxConditions}` });
  }
  if (groups > limits.maxGroups) {
    errors.push({ path: 'root', code: 'max-groups', message: `${groups} groups exceed ${limits.maxGroups}` });
  }

  const costUnits = [...unique.values()].reduce((s, w) => s + w, 0);
  const complexity: ComplexityReport = {
    depth: maxDepth,
    conditions,
    groups,
    timeframes: [...tfs],
    sources: [...sources],
    uniqueSeries: unique.size,
    costUnits,
    cost: costUnits > limits.highCostUnits ? 'high' : costUnits > limits.mediumCostUnits ? 'medium' : 'low',
  };

  return { ok: errors.length === 0, errors, warnings, complexity };
}

/** Strategy-level validation: metadata + exits + the active version's tree. */
export function validateStrategy(
  s: ScannerStrategy,
  limits: ComplexityLimits = DEFAULT_LIMITS,
): ValidationResult {
  const version = s.versions.find((v) => v.v === s.activeVersion);
  const base = version
    ? validateTree(version.tree, limits)
    : {
        ok: false,
        errors: [{ path: 'root', code: 'no-version', message: `active version ${s.activeVersion} not found` }],
        warnings: [],
        complexity: { depth: 0, conditions: 0, groups: 0, timeframes: [], sources: [], uniqueSeries: 0, costUnits: 0, cost: 'low' as const },
      };
  const errors = [...base.errors];
  if (!s.name.trim()) errors.push({ path: 'name', code: 'empty-name', message: 'strategy needs a name' });
  if (s.direction !== 'long' && s.direction !== 'short') {
    errors.push({ path: 'direction', code: 'bad-direction', message: 'direction must be long or short' });
  }
  if (!(s.exits.slAtr > 0)) errors.push({ path: 'exits', code: 'bad-sl', message: 'SL buffer must be > 0 ATR' });
  if (!(s.exits.tp1R > 0) || !(s.exits.tp2R > s.exits.tp1R) || !(s.exits.tp3R > s.exits.tp2R)) {
    errors.push({ path: 'exits', code: 'bad-tps', message: 'targets must satisfy 0 < TP1R < TP2R < TP3R' });
  }
  return { ...base, ok: errors.length === 0, errors };
}
