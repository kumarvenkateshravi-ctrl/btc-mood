// Strategy lint (Strategy Studio M4) — Grammarly for strategies. Pure,
// deterministic checks that run WHILE building: duplicates, contradictions,
// missing filters, style/timeframe mismatches, trigger-frequency honesty.
// Output: findings + a 0-100 Strategy Grade.

import type { Candle, Timeframe } from '../types';
import type { Condition, GroupNode, ScannerStrategy, StrategyRisk } from './types';
import { isCondition } from './types';
import { SCANNER_SOURCES } from './registry';
import { categoryOf } from './sourceCategories';
import { getStyleProfile, type TraderStyleId } from './styleProfiles';

// ---- Risk Studio defaults (schema lives in types.ts) -----------------------
export type { StrategyRisk };

export const DEFAULT_RISK: StrategyRisk = {
  breakEven: false,
  trailingAtr: null,
  positionRiskPct: 1,
  maxDailyLossPct: 3,
  maxTradesPerDay: 4,
};

// ---- Cadence ---------------------------------------------------------------

const WEEK_SECONDS = 7 * 24 * 3600;

/** Signals per week from a per-bar match series (rising edges = entries). */
export function estimateCadencePerWeek(matches: boolean[], candles: Candle[]): number | null {
  if (candles.length < 2 || matches.length !== candles.length) return null;
  const span = candles[candles.length - 1].time - candles[0].time;
  if (span < 24 * 3600) return null; // under a day of history is noise
  let edges = 0;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] && !matches[i - 1]) edges++;
  }
  return (edges / span) * WEEK_SECONDS;
}

/** A style's expected cadence normalized to signals/week. */
export function styleCadencePerWeek(styleId: TraderStyleId): { min: number; max: number } | null {
  const s = getStyleProfile(styleId);
  if (!Number.isFinite(s.cadence.max)) return null; // custom
  const factor = s.cadence.per === 'day' ? 7 : s.cadence.per === 'month' ? 1 / 4.345 : 1;
  return { min: s.cadence.min * factor, max: s.cadence.max * factor };
}

// ---- Lint ------------------------------------------------------------------

export interface LintFinding {
  id: string;
  severity: 'warn' | 'info';
  message: string;
}

export interface LintReport {
  findings: LintFinding[];
  /** 0-100 Strategy Grade (100 = clean). */
  grade: number;
}

export interface LintInput {
  tree: GroupNode;
  style?: TraderStyleId;
  ladder?: { primary: Timeframe; confirmation: Timeframe; higherTrend: Timeframe };
  /** Signals/week from estimateCadencePerWeek (null = unknown). */
  cadencePerWeek?: number | null;
}

const seriesKey = (c: Condition): string =>
  `${c.left.source}:${c.left.output}:${JSON.stringify(c.left.params ?? {})}:${c.tf}`;

function walk(node: GroupNode, out: Condition[] = []): Condition[] {
  for (const child of node.children) {
    if (isCondition(child)) out.push(child);
    else walk(child, out);
  }
  return out;
}

/** AND-scoped condition lists (direct condition children of AND groups). */
function andScopes(node: GroupNode, out: Condition[][] = []): Condition[][] {
  if (node.logic === 'AND') out.push(node.children.filter(isCondition));
  for (const child of node.children) {
    if (!isCondition(child)) andScopes(child, out);
  }
  return out;
}

export function lintStrategy(input: LintInput): LintReport {
  const findings: LintFinding[] = [];
  const conditions = walk(input.tree);

  // 1. Exact duplicates.
  const seen = new Map<string, number>();
  for (const c of conditions) {
    const key = `${seriesKey(c)}|${c.op}|${JSON.stringify(c.right)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) {
    if (n > 1) {
      const src = key.split(':')[0];
      findings.push({ id: 'duplicate', severity: 'warn', message: `Duplicate condition on ${SCANNER_SOURCES[src]?.name ?? src} — remove one.` });
      break; // one finding is enough to act on
    }
  }

  // 2. Contradictions inside an AND scope (X > a AND X < b with b <= a).
  outer: for (const scope of andScopes(input.tree)) {
    const byKey = new Map<string, Condition[]>();
    for (const c of scope) {
      const k = seriesKey(c);
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    for (const group of byKey.values()) {
      const lower = group.find((c) => (c.op === 'gt' || c.op === 'gte') && typeof c.right === 'number');
      const upper = group.find((c) => (c.op === 'lt' || c.op === 'lte') && typeof c.right === 'number');
      if (lower && upper && (upper.right as number) <= (lower.right as number)) {
        const src = SCANNER_SOURCES[lower.left.source]?.name ?? lower.left.source;
        findings.push({ id: 'conflict', severity: 'warn', message: `${src} can never be both > ${lower.right} and < ${upper.right} at once.` });
        break outer;
      }
    }
  }

  // 3. Missing volume confirmation.
  if (conditions.length > 0 && !conditions.some((c) => categoryOf(SCANNER_SOURCES[c.left.source] ?? { id: c.left.source, group: 'standard' }) === 'volume')) {
    findings.push({ id: 'no-volume', severity: 'info', message: 'No volume confirmation — institutional moves usually come with volume.' });
  }

  // 4. Single-timeframe strategy (no higher-TF gate).
  const tfs = new Set(conditions.map((c) => c.tf));
  if (conditions.length >= 2 && tfs.size === 1) {
    findings.push({ id: 'no-higher-tf', severity: 'info', message: 'All conditions share one timeframe — a higher-timeframe trend gate usually filters bad entries.' });
  }

  // 5. Too many conditions.
  if (conditions.length > 8) {
    findings.push({ id: 'too-many', severity: 'warn', message: `${conditions.length} conditions is overfit territory — every added rule shrinks the sample.` });
  }

  // 6. Style / timeframe mismatch. (A Daily gate is textbook for intraday and
  // slower; it only stops pulling its weight at scalper cadence.)
  if (input.style && input.style !== 'custom') {
    const slow = input.style === 'swing' || input.style === 'position';
    if (input.style === 'scalper' && conditions.some((c) => c.tf === '1d')) {
      findings.push({ id: 'style-tf', severity: 'warn', message: 'A Daily condition inside a scalping style rarely gates anything — it changes once a day.' });
    }
    if (slow && conditions.some((c) => c.tf === '5m')) {
      findings.push({ id: 'style-tf', severity: 'warn', message: 'A 5m condition inside a slow style adds noise, not signal.' });
    }
  }

  // 7. Live-only sources have no backtest coverage.
  if (conditions.some((c) => SCANNER_SOURCES[c.left.source]?.liveOnly)) {
    findings.push({ id: 'live-only', severity: 'info', message: 'A live-only source is used — backtests cannot cover it yet.' });
  }

  // 8/9. Trigger frequency vs the style's honest cadence.
  const expected = input.style ? styleCadencePerWeek(input.style) : null;
  if (input.cadencePerWeek != null && expected) {
    if (input.cadencePerWeek < expected.min / 3) {
      findings.push({ id: 'rare-trigger', severity: 'warn', message: `Fires ~${input.cadencePerWeek.toFixed(1)}×/week — a ${input.style} expects ${expected.min.toFixed(0)}–${expected.max.toFixed(0)}. Loosen a threshold or drop a condition.` });
    } else if (input.cadencePerWeek > expected.max * 3) {
      findings.push({ id: 'over-fire', severity: 'info', message: `Fires ~${input.cadencePerWeek.toFixed(0)}×/week — far above the ${input.style} range; expect noisy signals.` });
    }
  }

  const warns = findings.filter((f) => f.severity === 'warn').length;
  const infos = findings.length - warns;
  const grade = Math.max(20, Math.min(100, 100 - 12 * warns - 4 * infos));

  return { findings, grade };
}

/** Convenience: resolve a strategy's risk block with defaults. */
export function resolveRisk(risk?: Partial<StrategyRisk> | null): StrategyRisk {
  return { ...DEFAULT_RISK, ...(risk ?? {}) };
}

export type { ScannerStrategy };
