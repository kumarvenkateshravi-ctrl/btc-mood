# M2 — Category Intelligence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six independent category intelligence modules + a typed orchestrator that project M1 `IndicatorResult[]` into `CategoryEngineResult` — deterministic, invisible (no consumers yet), zero observable behavior change.

**Architecture:** `categoryTypes.ts` (typed contract per the frozen spec), `categories/shared.ts` (defensive diag readers, votes, neutral-result builder), six category modules (each: 5 dims, weights, states, signals, warnings), `categoryEngine.ts` fixed orchestrator. Everything consumes M1 output only.

**Tech Stack:** TypeScript, Vitest. Numeric helpers reused from `lib/mtf/indicators/shared.ts` (`clamp`, `conv`).

## Global Constraints

- **Spec is law:** every dim formula, weight, threshold, state precedence, signal/warning code+message+severity+source is frozen in `docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md`. Do not improvise; the spec tables are the implementation reference for Tasks 2–4.
- **M2 consumes only M1 output** — no candles, no `compute*()` calls, no cross-category dependencies.
- **No-evidence invariant:** all consumed magnitudes 0 ∧ all directionals 50 → neutral state, `confidence: 50`, `strength: 0`, `signals: []`, `warnings: []`, `score: 50`.
- Non-directional categories (volatility, quality): `score` always 50.
- **No observable change:** nothing outside `lib/mtf/**` + docs may be touched; full suite (944+) and `tsc` (no new errors; `components/ui/DataTable.tsx` errors are pre-existing) must pass.
- Weights JSDoc'd "Conservative default; tuned later against BTC data; API stable."
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.
- **Releasable-per-task invariant (user-mandated):** every task ends with ✅ `tsc` clean (no new errors) ✅ FULL suite green ✅ no observable behavior change ✅ exactly one atomic commit ✅ knowledge graph updated (post-commit graphify hook).

---

## Task 1: Contract + category shared helpers

**Files:**
- Create: `lib/mtf/categoryTypes.ts`
- Create: `lib/mtf/categories/shared.ts`
- Test: `lib/mtf/categories/shared.test.ts`

**Interfaces:**
- Produces: the full contract from the spec's "Contract" section, verbatim (`CategoryId`, six state unions, `CategoryState`, `CategoryDiagnostics`, `CategorySignal`, `CategoryResult<S>`, `CategoryEngineResult`), importing `Verdict` from `../types` (re-exported via `verdictOf` usage in modules).
- `categories/shared.ts` exports (consumed by Tasks 2–4):

```ts
import type { IndicatorResult } from '../intelligence';
import { clamp, conv } from '../indicators/shared';
export { clamp, conv };

export type IndicatorMap = Partial<Record<string, IndicatorResult>>;

/** Build an id→result map from the M1 registry output. */
export function toMap(indicators: IndicatorResult[]): IndicatorMap;

/** Defensive numeric read of an M1 diagnostic dim; fallback when absent/non-finite. */
export function dim(map: IndicatorMap, id: string, key: string, fallback: number): number;

/** Directional value → vote: +1 (>55) / −1 (<45) / 0. */
export function voteOf(x: number): -1 | 0 | 1;

/** |Σ votes| / n · 100 (0 when n = 0). */
export function voteAgreement(votes: number[]): number;

/** True iff all magnitudes are 0 and all directionals are 50 (no-evidence rule). */
export function noEvidence(directionals: number[], magnitudes: number[]): boolean;

/** Mean of finite numbers (fallback 50 when empty). */
export function mean(xs: number[]): number;
```

- `dim()` implementation: `const v = (map[id]?.diagnostics as Record<string, unknown> | undefined)?.[key]; return typeof v === 'number' && Number.isFinite(v) ? v : fallback;`

- [ ] **Step 1: Write failing tests** for `voteOf` (56→+1, 44→−1, 50→0, 55/45 boundaries→0), `voteAgreement` ([1,1,1]→100, [1,1,−1]→33, [1,1,0]→67, []→0), `noEvidence` (true/false cases), `dim` (reads a real number, falls back on missing indicator / empty diagnostics / non-number).
- [ ] **Step 2:** `npx vitest run lib/mtf/categories/shared.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `categoryTypes.ts` (contract verbatim from spec) + `categories/shared.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mtf): M2 category contract + shared helpers`

---

## Task 2: Trend + Momentum categories

**Files:**
- Create: `lib/mtf/categories/trend.ts`, `lib/mtf/categories/momentum.ts`
- Test: `lib/mtf/categories/trend.test.ts`, `lib/mtf/categories/momentum.test.ts`

**Interfaces:**
- Produces: `evaluateTrendCategory(map: IndicatorMap): CategoryResult<TrendState>`, `evaluateMomentumCategory(map): CategoryResult<MomentumState>`; exported `TREND_CONFIDENCE_WEIGHTS`, `TREND_STRENGTH_WEIGHTS`, `MOM_CONFIDENCE_WEIGHTS`, `MOM_STRENGTH_WEIGHTS`; `TrendCategoryDiagnostics` / `MomentumCategoryDiagnostics` (extend `CategoryDiagnostics`).

Reference module shape (trend.ts — momentum mirrors it with its own spec table):

```ts
// M2 — Trend category. Consumes M1 diagnostics only (ema/supertrend/adx).
// Formulas frozen in docs/superpowers/specs/2026-07-19-m2-category-intelligence-design.md
import { verdictOf } from '../types';
import type { CategoryResult, CategorySignal, TrendState } from '../categoryTypes';
import { type IndicatorMap, clamp, conv, dim, mean, noEvidence, voteAgreement, voteOf } from './shared';

export const TREND_CONTRIBUTORS = ['ema', 'supertrend', 'adx'];
/** Conservative default; tuned later against BTC data; API stable. */
export const TREND_CONFIDENCE_WEIGHTS = { direction: 0.3, alignment: 0.25, agreement: 0.2, persistence: 0.15, quality: 0.1 } as const;
/** Conservative default; tuned later against BTC data; API stable. */
export const TREND_STRENGTH_WEIGHTS = { quality: 0.35, persistence: 0.3, agreement: 0.2, alignment: 0.15 } as const;

export interface TrendCategoryDiagnostics extends CategoryDiagnostics {
  alignment: number; direction: number; persistence: number; agreement: number; quality: number;
}
// evaluateTrendCategory(map):
//   emaScore = map['ema']?.score ?? 50 (frozen bucket is directional evidence)
//   side = dim('supertrend','side',50); adxDir = dim('adx','direction',50)
//   votesVals = [emaScore, side, adxDir]
//   dims per spec table; score = round(direction); no-evidence check on
//   ([alignment, direction], [persistence, agreement, quality]) → neutral 'ranging'
//   confidence/strength = weighted per tables (conv on directional dims), rounded+clamped
//   state by spec precedence; signals/warnings per spec catalog with
//   { category: 'trend', source: [...] } on each.
```

- [ ] **Step 1: Failing tests.** Fixture helper builds synthetic `IndicatorResult`s (id + score + diagnostics only; other fields filler). Cases per module: bullish consensus (state `strong_bullish`/`accelerating` paths, signal codes), bearish mirror, disagreement (warnings), no-evidence (empty diagnostics for all → neutral state, confidence 50, strength 0, `signals/warnings []`), builder-exactness (hand-computed weighted mixes on fixed diagnostics), determinism (`toEqual` twice).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement both per spec tables. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mtf): M2 trend + momentum categories`

---

## Task 3: Volume + Volatility categories

**Files:**
- Create: `lib/mtf/categories/volume.ts`, `lib/mtf/categories/volatility.ts`
- Test: `lib/mtf/categories/volume.test.ts`, `lib/mtf/categories/volatility.test.ts`

**Interfaces:**
- Produces: `evaluateVolumeCategory(map): CategoryResult<VolumeState>`, `evaluateVolatilityCategory(map): CategoryResult<VolatilityState>`; weights `VOLCAT_*_WEIGHTS` / `VOLA_*_WEIGHTS`; diagnostics interfaces.

Same structure as Task 2, per the spec's Volume and Volatility tables. Volatility specifics: `score` hardcoded 50 (`verdict 'neutral'`); no-evidence check uses consumed inputs (`supertrend.distance`, `macd.separation`) — not the derived `squeeze`; no-evidence state `normal`.

- [ ] Steps 1–4: TDD as Task 2 (volume: spike/buying/selling/quiet/unconfirmed cases; volatility: expanding/compressed/disagreement/no-evidence; both: builder exactness + determinism).
- [ ] **Step 5:** Commit: `feat(mtf): M2 volume + volatility categories`

---

## Task 4: Quality + Participation categories

**Files:**
- Create: `lib/mtf/categories/quality.ts`, `lib/mtf/categories/participation.ts`
- Test: `lib/mtf/categories/quality.test.ts`, `lib/mtf/categories/participation.test.ts`

**Interfaces:**
- Produces: `evaluateQualityCategory(map): CategoryResult<QualityState>`, `evaluateParticipationCategory(map): CategoryResult<ParticipationState>`; weights `QUAL_*_WEIGHTS` / `PART_*_WEIGHTS`; diagnostics interfaces.

Quality specifics: score hardcoded 50; state bands read the **computed category strength** (`choppy` precedence when `persistence` dim ≤50 with evidence; no-evidence → `developing`). Participation specifics: `trendSupport` compares `voteOf(dim('obv','trend'))` against `voteOf(map['ema']?.score ?? 50)` — indicators only, no category input; contributors `['volume','obv','ema']`.

- [ ] Steps 1–4: TDD as Task 2 (quality: healthy/weak/choppy/developing + agreement dim exactness `100−(max−min)`; participation: strong-buying/selling/weak/unsupported-trend + trendSupport bucket 100/50/0).
- [ ] **Step 5:** Commit: `feat(mtf): M2 quality + participation categories`

---

## Task 5: Category engine orchestrator

**Files:**
- Create: `lib/mtf/categoryEngine.ts`
- Test: `lib/mtf/categoryEngine.test.ts`

**Interfaces:**
- Produces:

```ts
export const CATEGORY_SCHEMA_VERSION = 1 as const;
export const CATEGORY_CONTRIBUTORS: Record<CategoryId, string[]>; // from the six modules
export function computeCategoryIntelligence(indicators: IndicatorResult[]): CategoryEngineResult;
// = { schemaVersion: 1, categories: { trend: evaluateTrendCategory(map), ... } }
```

- [ ] **Step 1: Failing tests:** real-pipeline integration (default M1 registry `evaluate(series)` → engine → every category present, states within their unions, contributors match `CATEGORY_CONTRIBUTORS`, every signal has correct `category` + non-empty `source`); empty candles → M1 placeholders → all six categories hit the no-evidence invariant (confidence 50, strength 0, empty arrays); determinism; `schemaVersion === 1`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(mtf): M2 category engine orchestrator`

---

## Task 6: Full verification + graph + memory

- [ ] `npx vitest run` → all pass (944 baseline + new M2 tests).
- [ ] `npx tsc --noEmit` → no new errors (DataTable pre-existing only).
- [ ] `git status` sanity: only `lib/mtf/**` + docs changed → dashboard/Stack Score/Custom MTF/scanner/alerts/replay/trade setup untouched by construction.
- [ ] `graphify update .`
- [ ] Update memory `mtf-engine.md`: M2 complete, architecture frozen, next = M3 Market Confidence.

## Self-Review Notes

- **Spec coverage:** contract (Task 1), six categories (Tasks 2–4) each with the spec's exact dims/weights/states/signals/warnings, engine + Record + schemaVersion + contributors (Task 5), invisibility acceptance (Task 6). All six MTFM2Enhnce1 adjustments are in the contract/tasks; renames (distance/agreement/commitment) baked into the spec tables Tasks 3–4 implement.
- **Type consistency:** `evaluate<Cat>Category(map: IndicatorMap)` naming uniform; state unions from `categoryTypes.ts` only; helpers from `categories/shared.ts`.
- **No placeholders:** formula detail lives in the frozen spec tables (single source of truth); the plan's module sketch + spec tables together are unambiguous.
