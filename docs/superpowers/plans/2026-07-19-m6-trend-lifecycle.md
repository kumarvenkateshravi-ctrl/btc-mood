# M6 — Trend Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify where the controller timeframe's trend sits in its lifecycle (accumulation → breakout → confirmation → trend_establishment → healthy_pullback → continuation → exhaustion → distribution → reversal, or range), plus its trajectory, expected next stage, invalidation condition, and strength — consuming the frozen M5 surface only.

**Architecture:** additive `TimeframeSnapshot` fields (`trendFreshness`, `momentumExhaustion`) computed in `buildTimeframeSnapshots`; six small pure engines (stage, expectation, progression, invalidation, strength, explanation) composed by one orchestrator `computeTrendLifecycle`.

**Tech Stack:** TypeScript, Vitest. Reuses `lib/mtf/timeframe/**` (M5) and `lib/mtf/indicators/shared.ts` (`clamp`).

## Global Constraints

- **Spec is law:** every stage rule, expectation map, invalidation condition, strength formula, and threshold is frozen in `docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md`.
- **M6 never recomputes M1–M5** — consumes `TimeframeSnapshot[]` + `HierarchyResult` only. The snapshot extension is the one additive exception (computed in the M5 helper, not M6).
- **Additive-only schema change:** `TimeframeSnapshot` gains `trendFreshness`/`momentumExhaustion`; `schemaVersion` on `HierarchyResult`/`CategoryEngineResult`/`AgreementResult`/`ConfidenceResult` is unaffected (M6 introduces its own `schemaVersion: 1` on `TrendLifecycleResult`).
- **Controller TF is the headline**, with a per-TF stage map alongside.
- **Lifecycle Strength ≠ Freshness:** two distinct fields, never conflated.
- Pure, deterministic, replay-safe, closed-bar, no React/UI, generic/data-driven explanation.
- **Releasable-per-task invariant:** every task ends with ✅ `tsc` clean (no new errors beyond pre-existing `components/ui/DataTable.tsx`) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ graph updated.
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`. Nothing outside `lib/mtf/**` + docs.

---

## Task 1: Extend TimeframeSnapshot (additive) + contract

**Files:**
- Modify: `lib/mtf/timeframe/timeframeTypes.ts` (add 2 fields to `TimeframeSnapshot`)
- Modify: `lib/mtf/timeframe/snapshots.ts` (compute the 2 fields)
- Create: `lib/mtf/lifecycle/lifecycleTypes.ts`, `lib/mtf/lifecycle/config.ts`
- Test: extend `lib/mtf/timeframe/snapshots.test.ts`; create `lib/mtf/lifecycle/config.test.ts`

**Interfaces:**
- `TimeframeSnapshot` gains `trendFreshness: number` (from `supertrend` indicator's `diagnostics.flipFreshness`, defensive fallback 0), `momentumExhaustion: number` (from the `momentum` category's `diagnostics.exhaustion`, fallback 0).
- `lifecycleTypes.ts`: `TrendStage`, `LifecycleSignal`, `TrendLifecycleResult`, `computeTrendLifecycle` signature — contract verbatim from spec.
- `config.ts`: `LIFECYCLE_THRESHOLDS` + `CYCLE_ORDER: TrendStage[]` (canonical order for progression, `range` excluded/index −1).

- [ ] **Step 1: Write failing tests.**

Add to `lib/mtf/timeframe/snapshots.test.ts`:
```ts
it('includes trendFreshness and momentumExhaustion (additive M6 fields)', () => {
  const [s] = buildTimeframeSnapshots({ '1d': series(260, 100, 0.5) });
  expect(s.trendFreshness).toBeGreaterThanOrEqual(0);
  expect(s.trendFreshness).toBeLessThanOrEqual(100);
  expect(s.momentumExhaustion).toBeGreaterThanOrEqual(0);
  expect(s.momentumExhaustion).toBeLessThanOrEqual(100);
});
it('empty candles → freshness/exhaustion still well-formed', () => {
  const [s] = buildTimeframeSnapshots({ '1d': [] });
  expect(s.trendFreshness).toBe(0);
  expect(s.momentumExhaustion).toBe(0);
});
```

Create `lib/mtf/lifecycle/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CYCLE_ORDER, LIFECYCLE_THRESHOLDS } from './config';

describe('lifecycle config', () => {
  it('cycle order is the full canonical sequence, range excluded', () => {
    expect(CYCLE_ORDER).toEqual([
      'accumulation', 'breakout', 'confirmation', 'trend_establishment',
      'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal',
    ]);
    expect(CYCLE_ORDER).not.toContain('range');
  });
  it('thresholds are all 0-100 or valid fractions', () => {
    for (const v of Object.values(LIFECYCLE_THRESHOLDS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2:** Run → FAIL (fields/module missing).
- [ ] **Step 3: Implement.**

In `timeframeTypes.ts`, extend `TimeframeSnapshot`:
```ts
export interface TimeframeSnapshot {
  timeframe: Timeframe;
  bias: Verdict;
  agreement: number;
  conflict: number;
  confidence: number;
  regime: RegimeType;
  regimeClarity: number;
  /** M6 addition (additive): recency of the current trend, from supertrend.flipFreshness. */
  trendFreshness: number;
  /** M6 addition (additive): momentum overextension, from the momentum category's exhaustion dim. */
  momentumExhaustion: number;
}
```

In `snapshots.ts`, inside the loop (after `regime` is computed), read the two sources and add them to the pushed object:
```ts
    const stEntry = indicators.find((r) => r.id === 'supertrend');
    const stDiag = stEntry?.diagnostics as { flipFreshness?: number } | undefined;
    const trendFreshness = typeof stDiag?.flipFreshness === 'number' ? stDiag.flipFreshness : 0;

    const momDiag = categories.momentum.diagnostics as { exhaustion?: number };
    const momentumExhaustion = typeof momDiag.exhaustion === 'number' ? momDiag.exhaustion : 0;

    out.push({
      timeframe: tf,
      bias: agreement.dominantBias,
      agreement: agreement.agreement,
      conflict: agreement.conflict,
      confidence: confidence.confidence,
      regime: regime.regime,
      regimeClarity: regime.clarity,
      trendFreshness,
      momentumExhaustion,
    });
```

Create `lib/mtf/lifecycle/lifecycleTypes.ts`:
```ts
// M6 — Trend Lifecycle contract. Consumes the frozen M5 surface only (TimeframeSnapshot[]
// + HierarchyResult); never recomputes M1–M5. Spec:
// docs/superpowers/specs/2026-07-19-m6-trend-lifecycle-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { HierarchyResult, TimeframeSnapshot } from '../timeframe/timeframeTypes';

export type TrendStage =
  | 'accumulation' | 'breakout' | 'confirmation' | 'trend_establishment'
  | 'healthy_pullback' | 'continuation' | 'exhaustion' | 'distribution' | 'reversal' | 'range';

export interface LifecycleSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

export interface TrendLifecycleResult {
  schemaVersion: 1;
  timeframe: Timeframe;
  stage: TrendStage;
  direction: Verdict;
  lifecycleStrength: number;
  freshness: number;
  exhaustion: number;
  stageConfidence: number;
  nextStageConfidence: number;
  progression: { previous: TrendStage | null; current: TrendStage; trajectory: 'advancing' | 'stalling' | 'regressing' };
  expectation: { expected: TrendStage; rationale: string };
  invalidation: { invalidated: boolean; condition: string | null };
  perTimeframe: Partial<Record<Timeframe, { stage: TrendStage; direction: Verdict }>>;
  signals: LifecycleSignal[];
  warnings: LifecycleSignal[];
}

export type ComputeTrendLifecycle = (
  snapshots: TimeframeSnapshot[], hierarchy: HierarchyResult, previousStage?: TrendStage,
) => TrendLifecycleResult;
```

Create `lib/mtf/lifecycle/config.ts`:
```ts
// M6 — Trend Lifecycle configuration. Conservative defaults; tuned later; API stable.

import type { TrendStage } from './lifecycleTypes';

export const LIFECYCLE_THRESHOLDS = {
  exhaustHigh: 70, freshHigh: 70, freshMid: 40, alignConfirm: 60, strongTrend: 55, weakConfidence: 40,
  invalidationPenalty: 30,
} as const;

/** Canonical forward order for progression/expectation. 'range' is off-cycle. */
export const CYCLE_ORDER: TrendStage[] = [
  'accumulation', 'breakout', 'confirmation', 'trend_establishment',
  'healthy_pullback', 'continuation', 'exhaustion', 'distribution', 'reversal',
];
```

- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5: Releasable gate:** `npx tsc --noEmit` + `npx vitest run` (full suite).
- [ ] **Step 6: Commit:** `feat(mtf): M6 lifecycle contract + snapshot extension (trendFreshness, momentumExhaustion)`

---

## Task 2: Stage classifier

**Files:** Create `lib/mtf/lifecycle/stage.ts`, `stage.test.ts`.

**Interfaces:**
- `classifyStage(s: TimeframeSnapshot, hier: HierarchyResult): { stage: TrendStage; direction: Verdict; stageConfidence: number }` — controller-aware (uses `hier.overallMarketState`, `hier.alignment`/`hier.conflict` when `s.timeframe === hier.controller`, else a coarse per-TF form using only `s.regime/trendFreshness/momentumExhaustion/regimeClarity`, with `hier.alignment`/`hier.conflict` falling back to `s.confidence`-derived proxies when off-controller). `stageConfidence` per the spec's per-branch `marginScore` table, blended 50/50 with `s.confidence`, rounded and clamped 0–100.

- [ ] **Step 1: Write failing tests.** Build fixture `TimeframeSnapshot`s and minimal `HierarchyResult`s covering every branch in the spec's precedence list: compression+bullish→accumulation, compression+bearish→distribution, expansion+fresh+directional→breakout, ranging→range, trending+reversal_risk→reversal, trending+high exhaustion→exhaustion, trending+`*_pullback`→healthy_pullback, trending+`*_continuation`→continuation, trending+high freshness→breakout, trending+midFreshness+alignConfirm→confirmation, trending+else→trend_establishment. One per test, asserting `stage`, `direction === s.bias`, and `stageConfidence` in `[0,100]` with an exact hand-computed value for at least the breakout and reversal cases (e.g. breakout: `round(0.5·trendFreshness + 0.5·s.confidence)`).
- [ ] **Step 2:** FAIL. **Step 3:** implement per the spec's exact precedence order (first match wins — check in the listed sequence) and the `stageConfidence` marginScore table. **Step 4:** PASS.
- [ ] **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M6 trend stage classifier`

---

## Task 3: Expectation + Progression engines

**Files:** Create `lib/mtf/lifecycle/expectation.ts`, `progression.ts`, `expectation.test.ts`, `progression.test.ts`.

**Interfaces:**
- `expectNext(stage: TrendStage, exhaustion: number): { expected: TrendStage; rationale: string }` per the spec's forward map (continuation branches on `exhaustion ≥ LIFECYCLE_THRESHOLDS.exhaustHigh`).
- `progress(previous: TrendStage | null, current: TrendStage): { previous; current; trajectory: 'advancing' | 'stalling' | 'regressing' }` using `CYCLE_ORDER` indices (`range` = −1; `previous === null` → `'advancing'`).

- [ ] **Step 1: Write failing tests.**
  - expectation: one case per stage in the forward map (10 cases incl. `range→breakout`); continuation with low exhaustion → `healthy_pullback`, high exhaustion → `exhaustion`.
  - progression: `null→'trend_establishment'` → advancing; `'breakout'→'confirmation'` → advancing; `'confirmation'→'confirmation'` → stalling; `'continuation'→'trend_establishment'` → regressing; anything→`'range'` and `'range'`→anything (index −1 edge cases).
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M6 expectation + progression engines`

---

## Task 4: Invalidation + Lifecycle Strength engines

**Files:** Create `lib/mtf/lifecycle/invalidation.ts`, `strength.ts`, `invalidation.test.ts`, `strength.test.ts`.

**Interfaces:**
- `checkInvalidation(stage: TrendStage, s: TimeframeSnapshot, hier: HierarchyResult): { invalidated: boolean; condition: string | null }` per the spec's per-stage conditions.
- `lifecycleStrength(stage: TrendStage, s: TimeframeSnapshot, hier: HierarchyResult): number` per the spec's per-stage blend (use `hier.controllerAuthority` for `healthy_pullback`, `hier.conflict` for `reversal`).

- [ ] **Step 1: Write failing tests.**
  - invalidation: `trend_establishment` + low confidence → invalidated "confidence collapse"; `continuation` + htfBias opposing direction → "bias flip"; `breakout` + low freshness+alignment → "false breakout"; `healthy_pullback` + `reversal_risk` oms → "pullback failed into reversal"; a healthy trending case → not invalidated.
  - strength: one case per stage-group verifying the blend formula on hand-computed numbers (e.g. breakout = mean(freshness, alignment)); range in [0,100] for all.
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M6 invalidation + lifecycle strength engines`

---

## Task 5: Explanation + orchestrator

**Files:** Create `lib/mtf/lifecycle/explanation.ts`, `lifecycleEngine.ts`, `explanation.test.ts`, `lifecycleEngine.test.ts`.

**Interfaces:**
- `explainLifecycle(ctx): { signals: LifecycleSignal[]; warnings: LifecycleSignal[] }` — `LC_BREAKOUT`/`LC_TREND`/`LC_CONTINUATION`/`LC_EXHAUSTION` (name the controller TF); `LC_INVALIDATION` (names the condition), `LC_REVERSAL_RISK`, `LC_EXHAUSTION_WARN`.
- `computeTrendLifecycle(snapshots, hierarchy, previousStage?): TrendLifecycleResult` — composes: `classifyStage` on the controller snapshot (→ `stage`, `direction`, `stageConfidence`) → `progress(previousStage ?? null, stage)` → `expectNext(stage, exhaustion)` → `checkInvalidation` → `lifecycleStrength` → `nextStageConfidence = round(clamp(stageConfidence - (invalidation.invalidated ? LIFECYCLE_THRESHOLDS.invalidationPenalty : 0), 0, 100))` → per-TF map via `classifyStage` on each snapshot → `explainLifecycle` → assemble.

- [ ] **Step 1: Write failing tests.**
  - explanation: controlled contexts firing each code; a stage with no controller present → still returns without throwing.
  - orchestrator: **real pipeline** — `buildTimeframeSnapshots(candlesByTf) → computeTimeframeHierarchy → computeTrendLifecycle`; assert `schemaVersion:1`, valid `stage`/`direction`, `stageConfidence`/`nextStageConfidence` both in `[0,100]`, `perTimeframe` covers all input TFs, `expectation`/`invalidation`/`progression` well-formed; `previousStage` supplied → `progression.previous` reflects it and `trajectory` computed; **invalidated stage → `nextStageConfidence` strictly less than `stageConfidence`** (the discount applies); determinism (`toEqual` twice); empty candles → graceful `stage:'range'`-ish safe result (no throw).
- [ ] **Step 2–4:** TDD. **Step 5: gate.** **Step 6: Commit:** `feat(mtf): M6 lifecycle explanation + orchestrator`

---

## Task 6: Verification + docs + memory

- [ ] `npx vitest run` all green; `npx tsc --noEmit` clean.
- [ ] `git diff --name-only <base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` → empty.
- [ ] `graphify update .`; add an **M6 section** to `docs/architecture/market-intelligence-pipeline.md` (mark M6 shipped, M7 next; document the `TimeframeSnapshot` additive extension in the M5 section too) and update memory `mtf-engine.md`.
- [ ] **Commit:** `docs: M6 pipeline + memory; verification`

## Self-Review Notes

- **Spec coverage:** snapshot extension + contract (T1), stage classifier incl. all precedence branches + `stageConfidence` (T2), expectation + progression (T3), invalidation + strength (T4), `nextStageConfidence` + explanation + orchestrator + real pipeline (T5), verification/docs (T6). Hybrid decisions applied: `trendFreshness`/`momentumExhaustion` additive (T1), richer 9+1 stage set with honesty note on approximated stages (T2 spec ref), `lifecycleStrength` kept distinct from `freshness` (T4/contract), `previousStage` as an input param not a stored field (T5/contract), Expectation + Invalidation + Strength as separate small engines, not folded together (T3/T4), controller-TF headline with per-TF map (contract + T2/T5). **M7 reservation:** `stageConfidence`/`nextStageConfidence` added to the contract now (T1), computed in T2/T5 — explicitly NOT probabilities (M7's job); avoids a future contract revision when the Probability Engine ships.
- **Type consistency:** `TrendLifecycleResult`, `TrendStage`, `LifecycleSignal` from `lifecycleTypes.ts` used identically across all engines; `CYCLE_ORDER`/`LIFECYCLE_THRESHOLDS` single-sourced in `config.ts`.
- **No placeholders:** every formula and branch has exact logic in the frozen spec + this plan.
