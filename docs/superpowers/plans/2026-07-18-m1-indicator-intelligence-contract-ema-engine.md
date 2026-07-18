# M1 — Indicator Intelligence Contract + EMA Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `IndicatorIntelligence` contract (M1.0) and upgrade EMA to the first rich intelligence engine (M1.1) with **zero observable behavior change**.

**Architecture:** `types.ts` gains `IndicatorSignal` and optional rich fields on `IndicatorEvaluation`; new `intelligence.ts` holds `IndicatorIntelligence` / `IndicatorResult`; the registry's `evaluate()` assembles the full object with placeholders. New `lib/mtf/indicators/` folder hosts per-indicator engines (EMA first); `definitions.ts` stays a lightweight registry that delegates EMA evaluation.

**Tech Stack:** TypeScript, Vitest, `lib/pineMath.ts` (`emaPine`, seeds from bar 0, returns `(number|null)[]`).

## Global Constraints

- **Score frozen:** `score` / `display` / `verdict` / composite must stay byte-identical for all seven indicators. EMA score keeps the exact bucket: `e20>e50 && e50>=long → 100`, `e20<e50 && e50<=long → 0`, else `e20>e50 ? 65 : 35`, insufficient → 50, with `long = e200 ?? e50`.
- **Public API unchanged:** `computeAlignmentMatrix()` and all consumers untouched. Do NOT edit `lib/alignment.ts`, anything in `app/` or `components/`, or the other six indicators (RSI, MACD, ADX, OBV, Volume, Supertrend).
- **Architectural Rule (from spec):** intelligence values are **indicator-local evidence**, not market-level conclusions. Comments in new files must say "Indicator Confidence" / "Indicator Strength".
- Pure, deterministic, no global state, no extra passes over candle history where avoidable.
- **Performance (MTFEnh2):** each EMA series (`emaPine` 20/50/200) is computed exactly once per `evaluateEma` call and reused across score + all five dimensions — no redundant recomputation.
- **Diagnostics typing (MTFEnh2):** no `Record<string, unknown>` — a marker base `IndicatorDiagnostics` in `types.ts`; each indicator owns its concrete shape (`EmaDiagnostics extends IndicatorDiagnostics`); the registry never inspects it.
- **Evolution note (M2+, documented not implemented):** indicators will eventually build their full `IndicatorIntelligence` and the registry will only attach `weight` (coordinator, not transformer).
- Spec: `docs/superpowers/specs/2026-07-18-m1-indicator-intelligence-contract-ema-engine-design.md`.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.
- `IndicatorResult` in `lib/mtf/types.ts` is imported **only** by `lib/mtf/registry.ts` (verified) — safe to relocate.

---

## Task 1: M1.0 — Intelligence contract + registry assembly

**Files:**
- Create: `lib/mtf/intelligence.ts`
- Modify: `lib/mtf/types.ts` (widen `IndicatorEvaluation`, add `IndicatorSignal`, remove `IndicatorResult`)
- Modify: `lib/mtf/registry.ts` (assemble intelligence)
- Test: `lib/mtf/registry.test.ts`

**Interfaces:**
- Consumes: existing `IndicatorCategory`, `Verdict`, `verdictOf`, `IndicatorDefinition`.
- Produces (used by Tasks 2–3):
  - `types.ts`: `interface IndicatorSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; timestamp?: number }`; marker `interface IndicatorDiagnostics {}`; `IndicatorEvaluation` with optional `confidence?/strength?: number`, `diagnostics?: IndicatorDiagnostics`, `signals?/warnings?: IndicatorSignal[]`.
  - `intelligence.ts`: `interface IndicatorIntelligence { id; category; score; verdict; confidence; strength; display; diagnostics; signals; warnings }`; `type IndicatorResult = IndicatorIntelligence & { weight: number }`.
  - `registry.evaluate()` returns `IndicatorResult[]` with placeholders `confidence = ev.confidence ?? score`, `strength = ev.strength ?? score`, `diagnostics ?? {}`, `signals/warnings ?? []`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mtf/registry.test.ts` (bottom of file):

```ts
describe('M1.0 intelligence contract', () => {
  const r = createDefaultRegistry();
  const up = series(260, 100, 0.5);

  it('every result carries the intelligence fields with placeholder values', () => {
    for (const x of r.evaluate(up)) {
      expect(['trend', 'momentum', 'volume', 'strength']).toContain(x.category);
      expect(x.confidence).toBe(x.score);
      expect(x.strength).toBe(x.score);
      expect(x.diagnostics).toEqual({});
      expect(x.signals).toEqual([]);
      expect(x.warnings).toEqual([]);
    }
  });

  it('a rich evaluation passes through instead of placeholders', () => {
    const r2 = new IndicatorRegistry();
    r2.register({
      ...stubDef('rich'),
      evaluate: () => ({
        score: 80, display: 'Rich', confidence: 61, strength: 42,
        diagnostics: { a: 1 },
        signals: [{ code: 'X', message: 'x', severity: 'info' as const }],
        warnings: [{ code: 'Y', message: 'y', severity: 'warning' as const }],
      }),
    });
    const [x] = r2.evaluate(series(10, 100, 0.5));
    expect(x.confidence).toBe(61);
    expect(x.strength).toBe(42);
    expect(x.diagnostics).toEqual({ a: 1 });
    expect(x.signals[0].code).toBe('X');
    expect(x.warnings[0].severity).toBe('warning');
  });

  it('empty candles produce neutral intelligence placeholders', () => {
    for (const x of r.evaluate([])) {
      expect(x.confidence).toBe(50);
      expect(x.strength).toBe(50);
      expect(x.diagnostics).toEqual({});
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/mtf/registry.test.ts`
Expected: FAIL — `category`/`confidence`/`strength`/`diagnostics` undefined on results.

- [ ] **Step 3: Implement**

**`lib/mtf/types.ts`** — replace the `IndicatorEvaluation` and `IndicatorResult` blocks:

```ts
/** Machine-readable signal/warning emitted by an indicator (M1 contract). */
export interface IndicatorSignal {
  code: string;                       // e.g. 'EMA_ALIGNMENT_STRONG'
  message: string;                    // human-readable
  severity: 'info' | 'warning' | 'strong';
  /** Optional epoch-ms timing (unused in M1; replay/AI/reports attach later). */
  timestamp?: number;
}

/** Marker base for per-indicator diagnostics — each indicator OWNS its concrete
 * shape (EmaDiagnostics, later RsiDiagnostics, …); the registry never inspects it. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IndicatorDiagnostics {}

export interface IndicatorEvaluation {
  /** 0–100 directional sub-score (100 = max bull, 0 = max bear, 50 = neutral). */
  score: number;
  /** What a dashboard cell shows (a label or a formatted value). */
  display: string;
  // Optional indicator-local intelligence (M1). Absent → registry fills placeholders.
  confidence?: number;
  strength?: number;
  diagnostics?: IndicatorDiagnostics;
  signals?: IndicatorSignal[];
  warnings?: IndicatorSignal[];
}
```

Delete the old `export interface IndicatorResult extends IndicatorEvaluation { ... }` block (it moves to `intelligence.ts`).

**`lib/mtf/intelligence.ts`** (new):

```ts
// M1.0 — the Indicator Intelligence contract. Architectural Rule: these values
// are INDICATOR-LOCAL evidence (Indicator Confidence / Indicator Strength), not
// market-level conclusions; later engines (Category, Confidence, Market Context,
// Decision) aggregate them. Pure types; imports one-directionally from types.ts.
//
// Evolution (locked direction, M2+): indicator modules will construct their full
// IndicatorIntelligence themselves and the registry will only register,
// orchestrate, and attach the effective weight. Not implemented in M1.

import type { IndicatorCategory, IndicatorDiagnostics, IndicatorSignal, Verdict } from './types';

export interface IndicatorIntelligence {
  id: string;
  category: IndicatorCategory;
  /** Frozen directional 0–100 score — unchanged from M0. */
  score: number;
  verdict: Verdict;
  /** Indicator Confidence 0–100 (placeholder = score until the indicator produces it). */
  confidence: number;
  /** Indicator Strength 0–100, direction-independent (placeholder = score). */
  strength: number;
  display: string;
  diagnostics: IndicatorDiagnostics;
  signals: IndicatorSignal[];
  warnings: IndicatorSignal[];
}

/** What the registry returns per indicator: full intelligence + applied weight. */
export type IndicatorResult = IndicatorIntelligence & { weight: number };
```

**`lib/mtf/registry.ts`** — update imports and `evaluate()`:

```ts
import type { Candle } from '../types';
import {
  verdictOf,
  type IndicatorDefinition,
  type IndicatorEvaluation,
  type IndicatorSettingsMap,
  type IndicatorWeights,
} from './types';
import type { IndicatorResult } from './intelligence';
```

Replace the body of `evaluate()`:

```ts
  /** Evaluate every registered indicator; empty candles score neutral (50). */
  evaluate(candles: Candle[], opts?: EvaluateOptions): IndicatorResult[] {
    const resolved = this.resolveWeights(opts?.weights);
    return this.list().map((d) => {
      const ev: IndicatorEvaluation =
        candles.length === 0 ? { score: 50, display: '—' } : d.evaluate(candles, opts?.settings?.[d.id]);
      return {
        id: d.id,
        category: d.category,
        score: ev.score,
        display: ev.display,
        verdict: verdictOf(ev.score),
        confidence: ev.confidence ?? ev.score,
        strength: ev.strength ?? ev.score,
        diagnostics: ev.diagnostics ?? {},
        signals: ev.signals ?? [],
        warnings: ev.warnings ?? [],
        weight: resolved.get(d.id)!,
      };
    });
  }
```

`compositeScore()` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mtf/registry.test.ts lib/alignment.test.ts`
Expected: PASS — including the existing `matches the legacy computeTfCells sub-scores exactly` parity test.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing `components/ui/DataTable.tsx:419` error is known and not ours).

- [ ] **Step 6: Commit**

```bash
git add lib/mtf/types.ts lib/mtf/intelligence.ts lib/mtf/registry.ts lib/mtf/registry.test.ts
git commit -m "feat(mtf): M1.0 indicator intelligence contract"
```

---

## Task 2: M1.1 — EMA intelligence engine (module + tests, not yet wired)

**Files:**
- Create: `lib/mtf/indicators/ema.ts`
- Test: `lib/mtf/indicators/ema.test.ts`

**Interfaces:**
- Consumes: `IndicatorEvaluation`, `IndicatorSignal`, `labelOf`, `verdictOf` from `../types`; `pm.emaPine` from `../../pineMath`.
- Produces (used by Task 3): `evaluateEma(candles: Candle[]): IndicatorEvaluation`; exported tunables `EMA_SEP_SAT`, `EMA_SLOPE_LOOKBACK`, `EMA_SLOPE_GAIN`, `EMA_FRESH_DECAY`, `EMA_FRESH_FLOOR`, `EMA_CONFIDENCE_WEIGHTS`, `EMA_STRENGTH_WEIGHTS`; helpers `barsSinceCross`, `buildConfidence`, `buildStrength`; `interface EmaDiagnostics`.

- [ ] **Step 1: Write the failing tests**

Create `lib/mtf/indicators/ema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import {
  evaluateEma, barsSinceCross, buildConfidence, buildStrength,
  EMA_FRESH_DECAY, EMA_FRESH_FLOOR, type EmaDiagnostics,
} from './ema';

// ---- fixtures ----
const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 300, open: i ? closes[i - 1] : close,
    high: close + 1, low: close - 1, close, volume: 1000,
  }));
const rise = (n: number, base: number, step: number) => Array.from({ length: n }, (_, i) => base + i * step);
const fall = (n: number, base: number, step: number) => rise(n, base, -step);

/** Re-implements the frozen M0 bucket so every scenario proves score parity. */
function expectedFrozenScore(candles: Candle[]): number {
  const closes = candles.map((c) => c.close);
  const last = (a: (number | null)[]) => (a.length ? a[a.length - 1] : null);
  const e20 = last(pm.emaPine(closes, 20));
  const e50 = last(pm.emaPine(closes, 50));
  const e200 = last(pm.emaPine(closes, 200));
  if (e20 == null || e50 == null) return 50;
  const longTerm = e200 ?? e50;
  if (e20 > e50 && e50 >= longTerm) return 100;
  if (e20 < e50 && e50 <= longTerm) return 0;
  return e20 > e50 ? 65 : 35;
}

const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateEma — frozen score parity (all scenarios)', () => {
  const scenarios: Record<string, Candle[]> = {
    perfectBull: mk(rise(300, 100, 0.5)),
    strongBear: mk(fall(300, 300, 0.5)),
    mixed: mk([...fall(260, 300, 0.5), ...rise(40, 170, 2)]),
    flat: mk(Array(260).fill(100)),
    sideways: mk(Array.from({ length: 260 }, (_, i) => 100 + 10 * Math.sin(i / 5))),
    short: mk(rise(5, 100, 0.5)),
    empty: [],
  };
  for (const [name, candles] of Object.entries(scenarios)) {
    it(`score frozen: ${name}`, () => {
      expect(evaluateEma(candles).score).toBe(expectedFrozenScore(candles));
    });
  }
});

describe('evaluateEma — scenarios', () => {
  it('Perfect Bull: full alignment, price above all, mature trend is not penalized', () => {
    const r = evaluateEma(mk(rise(300, 100, 0.5)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(100);
    expect(d.alignment).toBe(100);
    expect(d.pricePosition).toBe(100);
    expect(d.slope).toBeGreaterThan(60);
    expect(d.freshness).toBe(50); // monotone rise → no cross ever → neutral, NOT 0
    expect(codes(r.signals!)).toContain('EMA_ALIGNMENT_STRONG');
    expect(codes(r.signals!)).toContain('EMA_PRICE_ABOVE_ALL');
    expect(r.confidence).toBeGreaterThan(50);
    expect(r.strength).toBeGreaterThan(50);
  });

  it('Strong Bear: mirrored — strength high despite bearish direction', () => {
    const r = evaluateEma(mk(fall(300, 300, 0.5)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(0);
    expect(d.alignment).toBe(0);
    expect(d.pricePosition).toBe(0);
    expect(d.slope).toBeLessThan(40);
    expect(codes(r.signals!)).toContain('EMA_PRICE_BELOW_ALL');
    expect(r.strength).toBeGreaterThan(50); // trend QUALITY, not direction
  });

  it('Mixed Alignment: partial bucket + mixed-alignment warning', () => {
    const r = evaluateEma(mk([...fall(260, 300, 0.5), ...rise(40, 170, 2)]));
    const d = r.diagnostics as EmaDiagnostics;
    expect([35, 65]).toContain(r.score);
    expect([35, 65]).toContain(d.alignment);
    expect(codes(r.warnings!)).toContain('EMA_MIXED_ALIGNMENT');
  });

  it('Old Cross: long-ago cross floors freshness and warns EMA_AGING', () => {
    const r = evaluateEma(mk([...fall(60, 300, 1), ...rise(240, 240, 1)]));
    const d = r.diagnostics as EmaDiagnostics;
    expect(d.freshness).toBe(EMA_FRESH_FLOOR);
    expect(codes(r.warnings!)).toContain('EMA_AGING');
  });

  it('Flat Market: compression + flat-slope warnings, minimal strength', () => {
    const r = evaluateEma(mk(Array(260).fill(100)));
    const d = r.diagnostics as EmaDiagnostics;
    expect(d.alignment).toBe(50);   // exact equality → neutral (diagnostic only)
    expect(d.separation).toBe(0);
    expect(d.slope).toBe(50);
    expect(d.freshness).toBe(50);
    expect(codes(r.warnings!)).toContain('EMA_COMPRESSION');
    expect(codes(r.warnings!)).toContain('EMA_FLAT_SLOPE');
    expect(r.strength).toBe(0);
  });

  it('Insufficient Data: empty candles → all-neutral diagnostics', () => {
    const r = evaluateEma([]);
    const d = r.diagnostics as EmaDiagnostics;
    expect(r.score).toBe(50);
    expect(d).toEqual({ alignment: 50, separation: 0, slope: 50, pricePosition: 50, freshness: 50 });
  });

  it('Sideways: everything stays in range and is deterministic', () => {
    const c = mk(Array.from({ length: 260 }, (_, i) => 100 + 10 * Math.sin(i / 5)));
    const a = evaluateEma(c);
    expect(a).toEqual(evaluateEma(c));
    const d = a.diagnostics as EmaDiagnostics;
    for (const v of [a.score, a.confidence!, a.strength!, d.alignment, d.separation, d.slope, d.pricePosition, d.freshness]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('barsSinceCross', () => {
  it('finds the last sign flip of e20−e50', () => {
    expect(barsSinceCross([1, 1, 3, 3], [2, 2, 2, 2])).toBe(2);   // flip between i=1 and i=2
    expect(barsSinceCross([3, 3, 3], [2, 2, 2])).toBeNull();      // never flips
    expect(barsSinceCross([2, 2], [2, 2])).toBeNull();            // always equal → no sign
    expect(barsSinceCross([], [])).toBeNull();
  });
});

describe('confidence & strength builders (from diagnostics only)', () => {
  const d: EmaDiagnostics = { alignment: 100, separation: 80, slope: 90, pricePosition: 100, freshness: 90 };
  it('conviction magnitude: perfect bull and perfect bear score identically', () => {
    const bear: EmaDiagnostics = { alignment: 0, separation: 80, slope: 10, pricePosition: 0, freshness: 90 };
    expect(buildConfidence(bear)).toBe(buildConfidence(d));
    expect(buildStrength(bear)).toBe(buildStrength(d));
  });
  it('confidence follows the documented weights', () => {
    // 0.40·100 + 0.20·80 + 0.20·80 + 0.10·100 + 0.10·90 = 91
    expect(buildConfidence(d)).toBe(91);
  });
  it('fresh-cross freshness decays by EMA_FRESH_DECAY per bar', () => {
    // sanity of constants used by freshness (guards accidental retuning)
    expect(EMA_FRESH_DECAY).toBe(4);
    expect(EMA_FRESH_FLOOR).toBe(20);
  });
});
```

Note on the weights test: `conv(slope=90)=80`, `conv(align=100)=100`, `conv(pp=100)=100` → `40 + 16 + 16 + 10 + 9 = 91`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/mtf/indicators/ema.test.ts`
Expected: FAIL — module `./ema` not found.

- [ ] **Step 3: Implement `lib/mtf/indicators/ema.ts`**

```ts
// M1.1 — EMA Intelligence Engine. First per-indicator module under
// lib/mtf/indicators/ (each M1.x milestone adds its own). Produces the frozen
// M0 score plus indicator-LOCAL intelligence (Indicator Confidence / Indicator
// Strength — evidence, not market conclusions; see the M1 spec's Architectural
// Rule). Pure and deterministic; formulas are conservative v1 defaults —
// tunable via the exported constants without touching the API.

import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import {
  labelOf, verdictOf,
  type IndicatorDiagnostics, type IndicatorEvaluation, type IndicatorSignal,
} from '../types';

// ---- tunables (conservative v1 — refine against real BTC data later) ----
/** Conservative default: % combined separation that saturates the dim. Tuned later against BTC data; API stable. */
export const EMA_SEP_SAT = 6;
/** Conservative default: bars for slope measurement. Tuned later against BTC data; API stable. */
export const EMA_SLOPE_LOOKBACK = 10;
/** Conservative default: % mean slope → points around 50. Tuned later against BTC data; API stable. */
export const EMA_SLOPE_GAIN = 8;
/** Conservative default: freshness points lost per bar since cross. Tuned later against BTC data; API stable. */
export const EMA_FRESH_DECAY = 4;
/** Conservative default: old-cross floor (M1Enhance: old cross → 20). Tuned later against BTC data; API stable. */
export const EMA_FRESH_FLOOR = 20;
/** Conservative default weights for Indicator Confidence. Tuned later against BTC data; API stable. */
export const EMA_CONFIDENCE_WEIGHTS = { alignment: 0.4, slope: 0.2, separation: 0.2, pricePosition: 0.1, freshness: 0.1 } as const;
/** Conservative default weights for Indicator Strength. Tuned later against BTC data; API stable. */
export const EMA_STRENGTH_WEIGHTS = { alignment: 0.5, separation: 0.25, slope: 0.25 } as const;

/** EMA-owned diagnostics shape (registry sees only the IndicatorDiagnostics marker). */
export interface EmaDiagnostics extends IndicatorDiagnostics {
  alignment: number;      // directional 0–100 (100 bull stack, 0 bear stack)
  separation: number;     // magnitude 0–100
  slope: number;          // directional 0–100 around 50
  pricePosition: number;  // directional 0 / 33 / 67 / 100
  freshness: number;      // magnitude; 50 = no crossover in history (neutral)
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Conviction magnitude of a directional dim: 50→0, 0 or 100→100. */
const conv = (x: number) => Math.abs(x - 50) * 2;

function lastFinite(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Frozen M0 score bucket — DO NOT CHANGE (observable behavior). */
function frozenScore(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null) return 50;
  const longTerm = e200 ?? e50;
  if (e20 > e50 && e50 >= longTerm) return 100;
  if (e20 < e50 && e50 <= longTerm) return 0;
  return e20 > e50 ? 65 : 35;
}

/** Diagnostic alignment: strict stacking; exact equalities are neutral. */
function alignmentDim(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null || e200 == null) return 50;
  if (e20 > e50 && e50 > e200) return 100;
  if (e20 < e50 && e50 < e200) return 0;
  if (e20 > e50) return 65;
  if (e20 < e50) return 35;
  return 50;
}

function separationDim(e20: number | null, e50: number | null, e200: number | null): number {
  if (e20 == null || e50 == null || e200 == null || e200 === 0) return 0;
  const sepPct = ((Math.abs(e20 - e50) + Math.abs(e50 - e200)) / e200) * 100;
  return clamp((sepPct / EMA_SEP_SAT) * 100, 0, 100);
}

function slopeDim(arrs: Array<(number | null)[]>): number {
  const pcts: number[] = [];
  for (const arr of arrs) {
    const lastIdx = arr.length - 1;
    const prevIdx = lastIdx - EMA_SLOPE_LOOKBACK;
    const a = prevIdx >= 0 ? arr[prevIdx] : null;
    const b = lastIdx >= 0 ? arr[lastIdx] : null;
    if (a != null && b != null && a !== 0) pcts.push(((b - a) / a) * 100);
  }
  if (pcts.length === 0) return 50;
  const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  return clamp(50 + mean * EMA_SLOPE_GAIN, 0, 100);
}

function pricePositionDim(price: number | null, e20: number | null, e50: number | null, e200: number | null): number {
  if (price == null || e20 == null || e50 == null || e200 == null) return 50;
  const above = [e20, e50, e200].filter((e) => price > e).length;
  return Math.round((above / 3) * 100); // 0 / 33 / 67 / 100
}

/** Bars since the last e20/e50 sign flip; null = no crossover in history. */
export function barsSinceCross(e20Arr: (number | null)[], e50Arr: (number | null)[]): number | null {
  const last = Math.min(e20Arr.length, e50Arr.length) - 1;
  const signAt = (i: number): number => {
    const a = e20Arr[i], b = e50Arr[i];
    return a == null || b == null ? 0 : Math.sign(a - b);
  };
  const cur = last >= 0 ? signAt(last) : 0;
  if (cur === 0) return null;
  for (let i = last - 1; i >= 0; i--) {
    const s = signAt(i);
    if (s !== 0 && s !== cur) return last - i;
  }
  return null;
}

function freshnessDim(e20Arr: (number | null)[], e50Arr: (number | null)[]): number {
  const bars = barsSinceCross(e20Arr, e50Arr);
  if (bars == null) return 50; // no crossover ≠ bad — mature trends stay neutral
  return clamp(100 - bars * EMA_FRESH_DECAY, EMA_FRESH_FLOOR, 100);
}

/** Indicator Confidence (0–100), built from the diagnostics object only. */
export function buildConfidence(d: EmaDiagnostics): number {
  const W = EMA_CONFIDENCE_WEIGHTS;
  return Math.round(clamp(
    W.alignment * conv(d.alignment) + W.slope * conv(d.slope) + W.separation * d.separation +
    W.pricePosition * conv(d.pricePosition) + W.freshness * d.freshness, 0, 100));
}

/** Indicator Strength (0–100): trend quality, direction-independent. */
export function buildStrength(d: EmaDiagnostics): number {
  const S = EMA_STRENGTH_WEIGHTS;
  return Math.round(clamp(
    S.alignment * conv(d.alignment) + S.separation * d.separation + S.slope * conv(d.slope), 0, 100));
}

function buildSignals(d: EmaDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.alignment === 100 || d.alignment === 0)
    out.push({ code: 'EMA_ALIGNMENT_STRONG', message: 'Strong EMA Alignment', severity: 'strong' });
  if (d.pricePosition === 100) out.push({ code: 'EMA_PRICE_ABOVE_ALL', message: 'Price Above All EMAs', severity: 'strong' });
  if (d.pricePosition === 0) out.push({ code: 'EMA_PRICE_BELOW_ALL', message: 'Price Below All EMAs', severity: 'strong' });
  if (d.freshness >= 70) out.push({ code: 'EMA_FRESH_CROSS', message: 'Fresh EMA Cross', severity: 'info' });
  if (d.separation >= 70) out.push({ code: 'EMA_WIDE_SEPARATION', message: 'Wide EMA Separation', severity: 'info' });
  if (d.slope >= 70) out.push({ code: 'EMA_RISING', message: 'Rising EMAs', severity: 'info' });
  if (d.slope <= 30) out.push({ code: 'EMA_FALLING', message: 'Falling EMAs', severity: 'info' });
  return out;
}

function buildWarnings(d: EmaDiagnostics): IndicatorSignal[] {
  const out: IndicatorSignal[] = [];
  if (d.separation <= 30) out.push({ code: 'EMA_COMPRESSION', message: 'Weak Separation', severity: 'warning' });
  if (d.freshness <= 25) out.push({ code: 'EMA_AGING', message: 'Aging Trend', severity: 'warning' });
  if (d.slope >= 40 && d.slope <= 60) out.push({ code: 'EMA_FLAT_SLOPE', message: 'Flat EMA Slope', severity: 'warning' });
  if (d.alignment === 35 || d.alignment === 65)
    out.push({ code: 'EMA_MIXED_ALIGNMENT', message: 'Mixed Alignment', severity: 'warning' });
  return out;
}

/** Pure, deterministic EMA evaluation: frozen score + indicator-local intelligence. */
export function evaluateEma(candles: Candle[]): IndicatorEvaluation {
  const closes = candles.map((c) => c.close);
  const e20Arr = pm.emaPine(closes, 20);
  const e50Arr = pm.emaPine(closes, 50);
  const e200Arr = pm.emaPine(closes, 200);
  const e20 = lastFinite(e20Arr);
  const e50 = lastFinite(e50Arr);
  const e200 = lastFinite(e200Arr);
  const price = closes.length ? closes[closes.length - 1] : null;

  const score = frozenScore(e20, e50, e200);
  const diagnostics: EmaDiagnostics = {
    alignment: alignmentDim(e20, e50, e200),
    separation: separationDim(e20, e50, e200),
    slope: slopeDim([e20Arr, e50Arr, e200Arr]),
    pricePosition: pricePositionDim(price, e20, e50, e200),
    freshness: freshnessDim(e20Arr, e50Arr),
  };
  return {
    score,
    display: labelOf(verdictOf(score)),
    confidence: buildConfidence(diagnostics),
    strength: buildStrength(diagnostics),
    diagnostics: { ...diagnostics },
    signals: buildSignals(diagnostics),
    warnings: buildWarnings(diagnostics),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mtf/indicators/ema.test.ts`
Expected: PASS. If a scenario band assertion fails (e.g. Mixed doesn't land in {35,65}), adjust the fixture series lengths/steps — NOT the frozen-score logic or the parity assertions.

- [ ] **Step 5: Commit**

```bash
git add lib/mtf/indicators/ema.ts lib/mtf/indicators/ema.test.ts
git commit -m "feat(mtf): M1.1 EMA intelligence engine (module + tests)"
```

---

## Task 3: Wire EMA definition to the engine

**Files:**
- Modify: `lib/mtf/definitions.ts` (EMA entry delegates; inline math removed)
- Test: `lib/mtf/registry.test.ts`

**Interfaces:**
- Consumes: `evaluateEma` from `./indicators/ema` (Task 2), M1.0 contract (Task 1).
- Produces: registry results where the `ema` entry has populated intelligence; other six keep placeholders.

- [ ] **Step 1: Write the failing tests**

In `lib/mtf/registry.test.ts`, inside the `M1.0 intelligence contract` describe block, change the placeholder test to exclude EMA and add an EMA-specific test:

```ts
  it('every result carries the intelligence fields with placeholder values', () => {
    for (const x of r.evaluate(up).filter((y) => y.id !== 'ema')) {   // EMA is rich as of M1.1
      expect(['trend', 'momentum', 'volume', 'strength']).toContain(x.category);
      expect(x.confidence).toBe(x.score);
      expect(x.strength).toBe(x.score);
      expect(x.diagnostics).toEqual({});
      expect(x.signals).toEqual([]);
      expect(x.warnings).toEqual([]);
    }
  });

  it('EMA produces populated intelligence while score/display/verdict stay frozen', () => {
    const ema = r.evaluate(up).find((x) => x.id === 'ema')!;
    expect(ema.score).toBe(100);          // frozen bucket for the steadily rising series
    expect(ema.display).toBe('Bullish');
    expect(ema.verdict).toBe('bullish');
    expect(Object.keys(ema.diagnostics).sort()).toEqual(
      ['alignment', 'freshness', 'pricePosition', 'separation', 'slope']);
    expect(ema.signals.length).toBeGreaterThan(0);
    expect(ema.confidence).toBeGreaterThanOrEqual(0);
    expect(ema.confidence).toBeLessThanOrEqual(100);
    expect(ema.strength).toBeGreaterThanOrEqual(0);
    expect(ema.strength).toBeLessThanOrEqual(100);
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run lib/mtf/registry.test.ts`
Expected: FAIL — `EMA produces populated intelligence…` fails (EMA diagnostics still `{}`); the filtered placeholder test passes.

- [ ] **Step 3: Delegate in `lib/mtf/definitions.ts`**

Add the import:

```ts
import { evaluateEma } from './indicators/ema';
```

Replace the whole EMA entry (currently the inline `evaluate(candles) { const closes = ... }` block) with:

```ts
  {
    id: 'ema',
    label: 'EMA Alignment',
    sub: '20 > 50 > 200',
    kind: 'label',
    category: 'trend',
    defaultWeight: 1,
    // M1.1: evaluation delegates to the EMA intelligence engine (score frozen there).
    evaluate: (candles) => evaluateEma(candles),
  },
```

Keep everything else in `definitions.ts` untouched (`pm`, `lastNum`, `labelDisplay` are still used by other entries).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mtf/registry.test.ts lib/mtf/indicators/ema.test.ts lib/alignment.test.ts`
Expected: PASS — including `matches the legacy computeTfCells sub-scores exactly` (score parity holds because `evaluateEma`'s `frozenScore` is the verbatim bucket).

- [ ] **Step 5: Commit**

```bash
git add lib/mtf/definitions.ts lib/mtf/registry.test.ts
git commit -m "feat(mtf): wire EMA definition to the intelligence engine"
```

---

## Task 4: Full verification + graph update

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all files pass (≥858 tests + the new ones). Any failure in `app/`/`components/` suites = observable behavior changed → stop and fix before proceeding.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing `components/ui/DataTable.tsx:419` is known).

- [ ] **Step 3: Freeze spot-check (behavior parity)**

Run: `npx vitest run lib/alignment.test.ts lib/mtf/registry.test.ts -t "parity"`
Expected: PASS — composite and per-indicator sub-scores identical to M0.

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`
Expected: AST-only refresh.

- [ ] **Step 5: Commit graph output only if desired**

`graphify-out/` is already dirty with pre-existing churn; leave it uncommitted unless the user asks.

---

## Self-Review Notes

- **Spec coverage:** M1.0 contract/types/registry/tests → Task 1; folder `lib/mtf/indicators/` + EMA engine + 8 scenarios (Perfect Bull, Strong Bear, Mixed, Fresh Cross via freshness/`barsSinceCross` unit tests + decay constants, Old Cross, Flat, Insufficient, Sideways) → Task 2; lightweight `definitions.ts` delegation → Task 3; acceptance gates (no observable change, parity, tsc) → Tasks 1/3/4. Structured `IndicatorSignal`, freshness no-cross→50, `EMA_CONFIDENCE_WEIGHTS` constants, Architectural Rule comments — all present in the code above.
- **Fresh Cross note:** exercised at unit level (`barsSinceCross` + `EMA_FRESH_DECAY` guards) rather than a brittle candle fixture; the Mixed scenario's recent cross often also emits `EMA_FRESH_CROSS`, but the plan does not assert it to avoid fixture brittleness.
- **Type consistency:** `evaluateEma` / `barsSinceCross` / `buildConfidence` / `buildStrength` / `EmaDiagnostics` / constants named identically across Tasks 2–3; `IndicatorResult` import path `./intelligence` used in Task 1 registry code.
- **Placeholder scan:** none — all steps carry complete code/commands.
- **MTFEnh2 review folded in:** `IndicatorDiagnostics` marker base (no `Record<string, unknown>`); `EmaDiagnostics extends IndicatorDiagnostics`; `IndicatorSignal.timestamp?`; JSDoc on every exported constant; performance criterion (each `emaPine` series computed once, reused across all dims); registry-as-coordinator direction documented in `intelligence.ts` header, deliberately not implemented in M1 per the review ("isn't urgent for M1").
