// Golden-master verification harness for PineScript → TypeScript indicator
// ports.
//
// The danger when hand-porting a TradingView indicator is *silent numerical
// divergence*: the port looks plausible on a chart but disagrees with
// TradingView by enough to flip a signal. This harness makes "the port
// matches the source" a checked fact instead of a hope.
//
// A fixture pins a fixed set of candles to the expected indicator output
// (plot values + signals) for a fixed set of parameters. Two provenances:
//   - source: 'tradingview' — authoritative data captured from TradingView's
//     Data Window / export. This is a TRUE golden master: it proves the port
//     is correct, not just stable.
//   - source: 'snapshot' — generated from our own implementation. This only
//     catches *regressions* (future edits that change output); it cannot tell
//     you the original port was right. Use it as a placeholder until a
//     TradingView fixture exists. See docs/PORTING_PINESCRIPT.md.
//
// This module is test-only (it touches node:fs) and must never be imported by
// app/client code.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Candle } from '../types';
import type { IndicatorResult, SignalSide } from '../indicatorFramework';

export type GoldenSource = 'tradingview' | 'snapshot';

export interface GoldenTolerance {
  /** Absolute tolerance: |expected - actual| <= abs passes. */
  abs: number;
  /** Relative tolerance: |Δ| / max(|exp|, |act|) <= rel passes. */
  rel: number;
}

/** A single expected plot cell. Color is cosmetic and intentionally ignored. */
export type ExpectedCell = number | null | { upper: number; lower: number };

export interface GoldenFixture {
  /** Indicator identifier, e.g. 'squeezeMomentum'. */
  indicator: string;
  source: GoldenSource;
  /** ISO date (YYYY-MM-DD) the expected values were captured. */
  capturedAt: string;
  /** Free-text provenance note (TradingView version, who captured, caveats). */
  note?: string;
  /** Parameters the indicator was computed with, both here and in TradingView. */
  params: Record<string, unknown>;
  tolerance: GoldenTolerance;
  /** The exact input candles. Both we and TradingView must see these. */
  candles: Candle[];
  expected: {
    /** plotId -> { barIndex(string) -> expected cell }. Sparse: only listed bars are checked. */
    plots: Record<string, Record<string, ExpectedCell>>;
    /** barIndex(string) -> expected signal. Sparse. */
    signals?: Record<string, SignalSide>;
  };
}

export const DEFAULT_TOLERANCE: GoldenTolerance = { abs: 1e-6, rel: 1e-4 };

export type MismatchKind =
  | 'plot-value'
  | 'plot-shape'
  | 'missing-plot'
  | 'signal';

export interface GoldenMismatch {
  kind: MismatchKind;
  plotId?: string;
  index: number;
  expected: unknown;
  actual: unknown;
  delta?: number;
  message: string;
}

export interface GoldenReport {
  ok: boolean;
  /** Number of individual comparisons made (plot cells + signals). */
  checked: number;
  mismatches: GoldenMismatch[];
}

// ---------------------------------------------------------------------------
// Fixture IO
// ---------------------------------------------------------------------------

export const FIXTURES_DIR = resolve(process.cwd(), 'lib/testing/fixtures');

export function fixturePath(name: string): string {
  return resolve(FIXTURES_DIR, `${name}.golden.json`);
}

export function fixtureExists(name: string): boolean {
  return existsSync(fixturePath(name));
}

export function loadFixture(name: string): GoldenFixture {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8')) as GoldenFixture;
}

export function saveFixture(name: string, fixture: GoldenFixture): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(fixturePath(name), JSON.stringify(fixture, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

type ActualCell =
  | { kind: 'number'; value: number }
  | { kind: 'band'; upper: number; lower: number }
  | { kind: 'null' }
  | { kind: 'other'; raw: unknown };

/** Normalize a plot data cell (number | {value,color} | {upper,lower} | null). */
function readActualCell(raw: unknown): ActualCell {
  if (raw === null || raw === undefined) return { kind: 'null' };
  if (typeof raw === 'number') {
    return Number.isNaN(raw) ? { kind: 'null' } : { kind: 'number', value: raw };
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.value === 'number') return { kind: 'number', value: o.value };
    if (typeof o.upper === 'number' && typeof o.lower === 'number') {
      return { kind: 'band', upper: o.upper, lower: o.lower };
    }
  }
  return { kind: 'other', raw };
}

export function withinTolerance(
  expected: number,
  actual: number,
  tol: GoldenTolerance,
): boolean {
  const diff = Math.abs(expected - actual);
  if (diff <= tol.abs) return true;
  const denom = Math.max(Math.abs(expected), Math.abs(actual), Number.EPSILON);
  return diff / denom <= tol.rel;
}

/**
 * Compare an indicator result against a fixture. Only the bars/plots listed in
 * `fixture.expected` are checked, so fixtures can be sparse (e.g. the last 50
 * bars copied from TradingView's Data Window).
 */
export function compareIndicator(
  result: IndicatorResult,
  fixture: GoldenFixture,
): GoldenReport {
  const tol = fixture.tolerance ?? DEFAULT_TOLERANCE;
  const mismatches: GoldenMismatch[] = [];
  let checked = 0;

  const plotById = new Map(result.plots.map((p) => [p.id, p]));

  for (const [plotId, cells] of Object.entries(fixture.expected.plots)) {
    const plot = plotById.get(plotId);
    if (!plot) {
      mismatches.push({
        kind: 'missing-plot',
        plotId,
        index: -1,
        expected: `plot "${plotId}"`,
        actual: `plots: [${result.plots.map((p) => p.id).join(', ')}]`,
        message: `indicator did not produce a plot with id "${plotId}"`,
      });
      continue;
    }

    for (const [idxStr, exp] of Object.entries(cells)) {
      const i = Number(idxStr);
      checked++;
      const actual = readActualCell(plot.data[i]);

      // Expected null → actual must be null.
      if (exp === null) {
        if (actual.kind !== 'null') {
          mismatches.push({
            kind: 'plot-value',
            plotId,
            index: i,
            expected: null,
            actual: actual.kind === 'number' ? actual.value : actual,
            message: `expected null, got a value`,
          });
        }
        continue;
      }

      // Expected band.
      if (typeof exp === 'object' && 'upper' in exp && 'lower' in exp) {
        if (actual.kind !== 'band') {
          mismatches.push({
            kind: 'plot-shape',
            plotId,
            index: i,
            expected: exp,
            actual,
            message: `expected a band {upper, lower}, got ${actual.kind}`,
          });
          continue;
        }
        if (!withinTolerance(exp.upper, actual.upper, tol)) {
          mismatches.push({
            kind: 'plot-value',
            plotId,
            index: i,
            expected: exp.upper,
            actual: actual.upper,
            delta: Math.abs(exp.upper - actual.upper),
            message: `band.upper out of tolerance`,
          });
        }
        if (!withinTolerance(exp.lower, actual.lower, tol)) {
          mismatches.push({
            kind: 'plot-value',
            plotId,
            index: i,
            expected: exp.lower,
            actual: actual.lower,
            delta: Math.abs(exp.lower - actual.lower),
            message: `band.lower out of tolerance`,
          });
        }
        continue;
      }

      // Expected number.
      if (actual.kind !== 'number') {
        mismatches.push({
          kind: 'plot-shape',
          plotId,
          index: i,
          expected: exp,
          actual,
          message: `expected a number, got ${actual.kind}`,
        });
        continue;
      }
      if (!withinTolerance(exp as number, actual.value, tol)) {
        mismatches.push({
          kind: 'plot-value',
          plotId,
          index: i,
          expected: exp,
          actual: actual.value,
          delta: Math.abs((exp as number) - actual.value),
          message: `value out of tolerance`,
        });
      }
    }
  }

  if (fixture.expected.signals) {
    for (const [idxStr, exp] of Object.entries(fixture.expected.signals)) {
      const i = Number(idxStr);
      checked++;
      const actual = result.signals[i];
      if (actual !== exp) {
        mismatches.push({
          kind: 'signal',
          index: i,
          expected: exp,
          actual: actual ?? '(out of range)',
          message: `signal mismatch`,
        });
      }
    }
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}

const MAX_REPORTED = 25;

/** Human-readable failure report, suitable as a vitest assertion message. */
export function formatGoldenReport(report: GoldenReport): string {
  if (report.ok) return `golden master OK (${report.checked} checks)`;
  const lines: string[] = [
    `Golden master FAILED: ${report.mismatches.length} mismatch(es) of ${report.checked} checks.`,
  ];
  for (const m of report.mismatches.slice(0, MAX_REPORTED)) {
    const where =
      m.kind === 'signal'
        ? `signal @ ${m.index}`
        : m.index < 0
          ? `plot ${m.plotId}`
          : `plot ${m.plotId} @ ${m.index}`;
    const delta = m.delta !== undefined ? ` (Δ ${m.delta.toExponential(3)})` : '';
    lines.push(
      `  [${where}] ${m.message}: expected ${fmt(m.expected)}, got ${fmt(m.actual)}${delta}`,
    );
  }
  if (report.mismatches.length > MAX_REPORTED) {
    lines.push(`  …and ${report.mismatches.length - MAX_REPORTED} more.`);
  }
  return lines.join('\n');
}

function fmt(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return v.toPrecision(8);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Snapshot fixture builder (regression baseline; NOT a true golden master)
// ---------------------------------------------------------------------------

function toExpectedCell(raw: unknown): ExpectedCell {
  const cell = readActualCell(raw);
  switch (cell.kind) {
    case 'number':
      return cell.value;
    case 'band':
      return { upper: cell.upper, lower: cell.lower };
    case 'null':
    default:
      return null;
  }
}

export interface BuildSnapshotOptions {
  indicator: string;
  params: Record<string, unknown>;
  candles: Candle[];
  result: IndicatorResult;
  /** How many trailing bars to capture per plot (default 50). */
  lastN?: number;
  tolerance?: GoldenTolerance;
  note?: string;
}

/**
 * Build a `source: 'snapshot'` fixture from a fresh compute. Captures the last
 * `lastN` bars of every plot plus every non-neutral signal. This is a
 * regression baseline only — it locks current behavior, it does NOT verify
 * correctness against TradingView.
 */
export function buildSnapshotFixture(opts: BuildSnapshotOptions): GoldenFixture {
  const lastN = opts.lastN ?? 50;
  const n = opts.candles.length;
  const start = Math.max(0, n - lastN);

  const plots: GoldenFixture['expected']['plots'] = {};
  for (const p of opts.result.plots) {
    const rec: Record<string, ExpectedCell> = {};
    for (let i = start; i < n; i++) rec[String(i)] = toExpectedCell(p.data[i]);
    plots[p.id] = rec;
  }

  const signals: Record<string, SignalSide> = {};
  opts.result.signals.forEach((s, i) => {
    if (s !== 'neutral') signals[String(i)] = s;
  });

  return {
    indicator: opts.indicator,
    source: 'snapshot',
    capturedAt: new Date().toISOString().slice(0, 10),
    note:
      opts.note ??
      'SNAPSHOT baseline (regression guard only). Replace with TradingView-sourced data for true correctness — see docs/PORTING_PINESCRIPT.md.',
    params: opts.params,
    tolerance: opts.tolerance ?? DEFAULT_TOLERANCE,
    candles: opts.candles,
    expected: { plots, signals },
  };
}
