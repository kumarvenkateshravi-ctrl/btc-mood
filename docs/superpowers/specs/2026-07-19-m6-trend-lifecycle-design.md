# M6 — Trend Lifecycle

**Date:** 2026-07-19 · **Status:** Approved & frozen (first-cut + MTFM6plan hybrid decisions)
**Builds on:** M5 (`lib/mtf/timeframe/**`). **Constitution:** `docs/architecture/market-intelligence-pipeline.md`
**Roadmap:** M6 of M0–M10.

M5 answers "what is the current multi-timeframe *context*?"; **M6 answers "where are we in the *evolution*
of the trend?"** — the lifecycle stage, its trajectory, what's expected next, and what would invalidate it.
Deterministic, replay-safe, closed-bar, no UI, no consumers yet.

## Consumes / boundary

M6 consumes the frozen M6-facing surface — `TimeframeSnapshot[]` + `HierarchyResult` — **never recomputes**
M1–M5. It reasons on the **controller timeframe** (the authoritative trend) as the headline, with a per-TF
stage map alongside.

## Additive M5 change (schemaVersion stays 1)

`TimeframeSnapshot` gains two fields, computed in `buildTimeframeSnapshots` from already-computed M1/M2
diagnostics (additive; existing consumers unaffected):
- `trendFreshness: number` — 0–100 (higher = fresher trend). Source: the `supertrend` indicator's
  `diagnostics.flipFreshness` (bars since the last side flip → recency of the current trend).
- `momentumExhaustion: number` — 0–100 (higher = more exhausted). Source: the `momentum` category's
  `diagnostics.exhaustion`.

Read defensively (fallback 0 when absent).

## Stage taxonomy

```ts
export type TrendStage =
  | 'accumulation' | 'breakout' | 'confirmation' | 'trend_establishment'
  | 'healthy_pullback' | 'continuation' | 'exhaustion' | 'distribution' | 'reversal' | 'range';
```
Canonical cycle order (for trajectory/expectation): accumulation → breakout → confirmation →
trend_establishment → healthy_pullback → continuation → exhaustion → distribution → reversal → (accumulation).
`range` is off-cycle (index −1).

**Honesty note:** `accumulation`/`distribution`/`confirmation` are conservative **approximations** from a
single snapshot (regime + context bias + freshness), documented as heuristics; the rest classify cleanly.

## Config (`lib/mtf/lifecycle/config.ts`, tunable — "conservative default; tuned later; API stable")

```ts
export const LIFECYCLE_THRESHOLDS = {
  exhaustHigh: 70, freshHigh: 70, freshMid: 40, alignConfirm: 60, strongTrend: 55, weakConfidence: 40,
} as const;
```

## Stage classifier (`stage.ts`)

`classifyStage(s: TimeframeSnapshot, hier: HierarchyResult): { stage: TrendStage; direction: Verdict }`.
`direction = s.bias`. `oms = hier.overallMarketState`. Precedence:

- **Non-trending regime** (`ranging`/`compression`/`expansion`):
  - `compression` → `accumulation` if `htfBias` bullish, `distribution` if bearish, else `range`.
  - `expansion` with directional bias and `trendFreshness ≥ freshHigh` → `breakout`, else `range`.
  - `ranging` → `range`.
- **Trending regime** (`trending_up`/`trending_down`), precedence:
  1. `oms === 'reversal_risk'` → `reversal`
  2. `momentumExhaustion ≥ exhaustHigh` → `exhaustion`
  3. `oms` is `*_pullback` → `healthy_pullback`
  4. `oms` is `*_continuation` → `continuation`
  5. `trendFreshness ≥ freshHigh` → `breakout`
  6. `trendFreshness ≥ freshMid && alignment ≥ alignConfirm` → `confirmation`
  7. else → `trend_establishment`

Per-TF map: `classifyStage` on each snapshot (using its own bias; `oms` only meaningful at controller, so
per-TF uses a reduced form — regime + freshness + exhaustion → coarse stage).

## Expectation engine (`expectation.ts`)

`expectNext(stage, exhaustion): { expected: TrendStage; rationale: string }` — deterministic forward map,
exhaustion-aware:
- accumulation→breakout · breakout→confirmation · confirmation→trend_establishment ·
  trend_establishment→healthy_pullback · healthy_pullback→continuation ·
  continuation→ `exhaustion` if `exhaustion ≥ exhaustHigh` else `healthy_pullback` ·
  exhaustion→distribution · distribution→reversal · reversal→accumulation · range→breakout.

## Progression engine (`progression.ts`)

`progress(previous: TrendStage | null, current: TrendStage): { previous; current; trajectory }` where
`trajectory` compares canonical indices: current > previous → `advancing`; equal → `stalling`;
current < previous → `regressing`; previous null → `advancing`. (`range` index −1.)

## Invalidation engine (`invalidation.ts`)

`checkInvalidation(stage, s, hier): { invalidated: boolean; condition: string | null }` — deterministic:
- trending stages (`trend_establishment`/`continuation`/`confirmation`): `confidence < weakConfidence` →
  "confidence collapse"; or `htfBias` opposes `direction` → "bias flip".
- `breakout`/`confirmation`: `trendFreshness < freshMid && alignment < alignConfirm` → "false breakout".
- `healthy_pullback`: `oms === 'reversal_risk'` → "pullback failed into reversal".
- else → not invalidated.

## Lifecycle strength (`strength.ts`)

`lifecycleStrength(stage, s, hier): number` (0–100) — how strongly the stage is expressed (NOT age):
- breakout/confirmation → blend(trendFreshness, alignment)
- trend_establishment/continuation → blend(regimeClarity, alignment, 100−exhaustion)
- healthy_pullback → controller/context authority
- exhaustion/distribution → momentumExhaustion
- reversal → conflict (how decisively the split)
- accumulation/range → regimeClarity (compression tightness)

## Explanation (`explanation.ts`)

Generic codes, data-driven: signals `LC_BREAKOUT`, `LC_TREND`, `LC_CONTINUATION`, `LC_EXHAUSTION` (names TF);
warnings `LC_INVALIDATION` (names condition), `LC_REVERSAL_RISK`, `LC_EXHAUSTION_WARN`.

## Contract (`lib/mtf/lifecycle/lifecycleTypes.ts`)

```ts
export interface LifecycleSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

export interface TrendLifecycleResult {
  schemaVersion: 1;
  timeframe: Timeframe;          // controller TF (headline)
  stage: TrendStage;
  direction: Verdict;
  lifecycleStrength: number;     // 0–100 (stage expression)
  freshness: number;             // 0–100 (age proxy — distinct from strength)
  exhaustion: number;            // 0–100
  progression: { previous: TrendStage | null; current: TrendStage; trajectory: 'advancing' | 'stalling' | 'regressing' };
  expectation: { expected: TrendStage; rationale: string };
  invalidation: { invalidated: boolean; condition: string | null };
  perTimeframe: Partial<Record<Timeframe, { stage: TrendStage; direction: Verdict }>>;
  signals: LifecycleSignal[];
  warnings: LifecycleSignal[];
}

export function computeTrendLifecycle(
  snapshots: TimeframeSnapshot[], hierarchy: HierarchyResult, previousStage?: TrendStage,
): TrendLifecycleResult;
```
`previousStage` is an **input** (reserved, like `previousAgreement`) — not stored in the contract; Progression
owns previous→current→trajectory.

## Files & testing

`lib/mtf/lifecycle/{lifecycleTypes, config, stage, expectation, progression, invalidation, strength,
explanation, lifecycleEngine}.ts` + colocated tests. Real-pipeline test: `buildTimeframeSnapshots →
computeTimeframeHierarchy → computeTrendLifecycle`. Coverage: each stage from crafted snapshots, expectation
map, trajectory, invalidation conditions, strength ranges, snapshot-extension fields, determinism.
`schemaVersion:1` additive-only.

## Acceptance

Pure, deterministic, replay-safe, no UI. **Releasable-per-task invariant.** Nothing outside `lib/mtf/**` +
docs; M6 invisible (no consumers). **M7-facing durable surface:** `stage`, `direction`, `lifecycleStrength`,
`freshness`, `exhaustion`, `expectation`, `invalidation`, per-TF stages — M7 (Probability) consumes these.
