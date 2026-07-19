# M3 — Market Agreement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic, deterministic engine that measures how much the market agrees with itself — `computeAgreement(indicatorResults, categoryResults, previousAgreement?) → AgreementResult` — consuming M1/M2 outputs only, naming no specific indicator or category.

**Architecture:** Generic `Voter` primitive → per-layer `LayerAgreement` (indicators, categories) → combined dominance + blended agreement/conflict → pattern-based explanation → orchestrator. Pure functions under `lib/mtf/agreement/`.

**Tech Stack:** TypeScript, Vitest. Numeric helper `clamp` reused from `lib/mtf/indicators/shared.ts`.

## Global Constraints

- **Spec is law:** every formula, threshold, state rule, and signal/warning code is frozen in `docs/superpowers/specs/2026-07-19-m3-market-agreement-engine-design.md`. Implement exactly.
- **Generic-purity law:** no `if id === 'ema'` / `if id === 'trend'` anywhere. Consume only `Voter` public properties (`id`, `verdict`, `confidence`, `weight?`). Component names in messages come from contributor `id`s.
- **Consumes M1/M2 only** — no candles, no recomputation. Pure, replay-safe, closed-bar, no React/UI.
- **Neutral in denominator** (agreement dilutes on neutral); **conflict independent** (not `100−agreement`, and never overrides `state`); **dominantBias from combined weighted vote**; **default blend 0.4 indicator / 0.6 category** (tunable constant).
- **Releasable-per-task invariant (user-mandated):** every task ends with ✅ `tsc` clean (no new errors beyond the pre-existing `components/ui/DataTable.tsx` ones) ✅ FULL suite green ✅ no observable behavior change ✅ one atomic commit ✅ knowledge graph updated (post-commit graphify hook).
- Test runner: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.
- Nothing outside `lib/mtf/**` + docs may change (M3 has no consumers yet).

---

## Task 1: Contract + vote primitive + conflict formula

**Files:**
- Create: `lib/mtf/agreement/agreementTypes.ts`, `lib/mtf/agreement/vote.ts`, `lib/mtf/agreement/conflict.ts`
- Test: `lib/mtf/agreement/vote.test.ts`, `lib/mtf/agreement/conflict.test.ts`

**Interfaces:**
- `agreementTypes.ts`: the full contract from the spec verbatim (`Voter`, `AgreementState`, `ConsensusLabel`, `ContributorLayer`, `Contributor`, `AgreementSignal`, `AgreementDiagnostics`, `AgreementResult`, `LayerAgreement`), importing `Verdict` from `../types`.
- `vote.ts` (consumed by Tasks 2–4):

```ts
import type { Verdict } from '../types';
import type { Contributor, ContributorLayer, Voter } from './agreementTypes';

export interface Tally {
  bull: number; bear: number; neutral: number; total: number;
  bullFrac: number; bearFrac: number; neutralFrac: number;
}
export function tally(voters: Voter[]): Tally;                 // adds (weight ?? 1) × confidence per verdict bucket
export function agreementFrom(t: Tally): number;              // round(clamp(max/total·100)); total 0 → 0
export function dominanceFrom(t: { bull: number; bear: number; neutral: number }): Verdict;
export function contributorsOf(voters: Voter[], layer: ContributorLayer): Contributor[];
```

- `conflict.ts`: `export function conflictFrom(bull: number, bear: number, total: number): number;`

- [ ] **Step 1: Write failing tests.**

`conflict.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { conflictFrom } from './conflict';
describe('conflictFrom', () => {
  it('evenly split directional votes → high', () => { expect(conflictFrom(49, 48, 100)).toBe(96); });
  it('one-sided → low', () => { expect(conflictFrom(95, 5, 100)).toBe(10); });
  it('unanimous → 0', () => { expect(conflictFrom(100, 0, 100)).toBe(0); });
  it('all neutral (no directional mass) → 0', () => { expect(conflictFrom(0, 0, 100)).toBe(0); });
  it('perfectly even → scaled by directional share', () => { expect(conflictFrom(40, 40, 100)).toBe(80); });
});
```
`vote.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { tally, agreementFrom, dominanceFrom, contributorsOf } from './vote';
import type { Voter } from './agreementTypes';
const v = (id: string, verdict: Voter['verdict'], confidence: number, weight?: number): Voter => ({ id, verdict, confidence, weight });

describe('tally', () => {
  it('sums (weight ?? 1) × confidence per bucket', () => {
    const t = tally([v('a', 'bullish', 80, 2), v('b', 'bearish', 50), v('c', 'neutral', 40)]);
    expect(t.bull).toBe(160); expect(t.bear).toBe(50); expect(t.neutral).toBe(40); expect(t.total).toBe(250);
    expect(t.bullFrac).toBeCloseTo(0.64, 5);
  });
  it('empty → zeros', () => { expect(tally([])).toEqual({ bull: 0, bear: 0, neutral: 0, total: 0, bullFrac: 0, bearFrac: 0, neutralFrac: 0 }); });
});
describe('agreementFrom', () => {
  it('dominant share, neutral in denominator', () => {
    // 6 bull conf 90 (weight 1) = 540; 1 neutral conf 60 = 60; total 600 → 540/600 = 90
    expect(agreementFrom(tally([...Array(6).fill(0).map((_, i) => v(`b${i}`, 'bullish', 90)), v('n', 'neutral', 60)]))).toBe(90);
  });
  it('total 0 → 0', () => { expect(agreementFrom(tally([]))).toBe(0); });
});
describe('dominanceFrom', () => {
  it('picks strict directional max, ties/neutral-max → neutral', () => {
    expect(dominanceFrom({ bull: 3, bear: 1, neutral: 2 })).toBe('bullish');
    expect(dominanceFrom({ bull: 1, bear: 3, neutral: 2 })).toBe('bearish');
    expect(dominanceFrom({ bull: 2, bear: 2, neutral: 1 })).toBe('neutral');
    expect(dominanceFrom({ bull: 1, bear: 1, neutral: 5 })).toBe('neutral');
  });
});
describe('contributorsOf', () => {
  it('maps to {id, layer, vote, weight×confidence}', () => {
    expect(contributorsOf([v('ema', 'bullish', 80, 2)], 'indicator')).toEqual([{ id: 'ema', layer: 'indicator', vote: 'bullish', weight: 160 }]);
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/mtf/agreement/vote.test.ts lib/mtf/agreement/conflict.test.ts` → FAIL (modules missing).
- [ ] **Step 3:** Implement `agreementTypes.ts` (contract verbatim), `vote.ts`, `conflict.ts` per spec. `tally` verdict buckets by exact `verdict` string; `conflictFrom` uses `clamp` from `../indicators/shared`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Releasable gate:** `npx tsc --noEmit` (no new errors) + `npx vitest run` (full suite green).
- [ ] **Step 6: Commit:** `feat(mtf): M3 agreement contract + vote/conflict primitives`

---

## Task 2: Indicator + Category layer engines

**Files:**
- Create: `lib/mtf/agreement/indicatorAgreement.ts`, `lib/mtf/agreement/categoryAgreement.ts`
- Test: `lib/mtf/agreement/indicatorAgreement.test.ts`, `lib/mtf/agreement/categoryAgreement.test.ts`

**Interfaces:**
- Produces: `indicatorAgreement(indicators: IndicatorResult[]): LayerAgreement`, `categoryAgreement(categories: CategoryResult[]): LayerAgreement`.

Both build via a shared internal helper (place in `vote.ts` as `layerAgreementOf(voters, layer): LayerAgreement`):
```ts
export function layerAgreementOf(voters: Voter[], layer: ContributorLayer): LayerAgreement {
  const t = tally(voters);
  return {
    agreement: agreementFrom(t),
    conflict: conflictFrom(t.bull, t.bear, t.total),
    dominantBias: dominanceFrom(t),
    bull: t.bull, bear: t.bear, neutral: t.neutral, total: t.total,
    bullFrac: t.bullFrac, bearFrac: t.bearFrac, neutralFrac: t.neutralFrac,
    contributors: contributorsOf(voters, layer),
  };
}
```
(Import `conflictFrom` into `vote.ts`; this keeps the layer engines one-liners.) `indicatorAgreement` maps `IndicatorResult` → `Voter` (they already are structurally: `{ id, verdict, confidence, weight }`) and calls `layerAgreementOf(indicators, 'indicator')`. `categoryAgreement` calls `layerAgreementOf(categories, 'category')` (no `weight` → 1).

- [ ] **Step 1: Failing tests.** Synthetic voters. Cases each: all-bull (agreement 100, dominant bullish, conflict 0), all-bear, mixed (dominant side + conflict > 0), mostly-neutral (dominant neutral), no-evidence/empty (agreement 0, conflict 0, dominant neutral, contributors []). Assert `contributors` carry `layer` and `weight = weight×confidence` (indicators) / `= confidence` (categories). Fixtures use minimal `IndicatorResult`/`CategoryResult` (only `id/verdict/confidence[/weight]` matter).
- [ ] **Step 2:** Run → FAIL. **Step 3:** add `layerAgreementOf` to `vote.ts` + implement both engines. **Step 4:** Run → PASS.
- [ ] **Step 5: Releasable gate** (tsc + full suite).
- [ ] **Step 6: Commit:** `feat(mtf): M3 indicator + category layer agreement`

---

## Task 3: Combined dominance + explanation

**Files:**
- Create: `lib/mtf/agreement/dominance.ts`, `lib/mtf/agreement/explanation.ts`
- Test: `lib/mtf/agreement/dominance.test.ts`, `lib/mtf/agreement/explanation.test.ts`

**Interfaces:**
- `dominance.ts`:
```ts
export interface CombinedVote { dominantBias: Verdict; bull: number; bear: number; neutral: number; dominantShare: number; minorityShare: number; }
export function combine(ind: LayerAgreement, cat: LayerAgreement, blend: { indicator: number; category: number }): CombinedVote;
```
Renormalize blend weights when a layer's `total` is 0 (empty → all weight to the other; both empty → neutral, shares 0). `dominantShare = round2(max(bull,bear))`, `minorityShare = round2(min(bull,bear))` where `round2(x) = Math.round(x*100)/100`.
- `explanation.ts`:
```ts
export interface ExplainContext {
  agreement: number; conflict: number; dominantBias: Verdict; state: AgreementState;
  dominantShare: number; minorityShare: number;
  ind: LayerAgreement; cat: LayerAgreement; contributors: Contributor[];
  thresholds: { highConflict: number; oneSided: number; lowDirection: number };
}
export function explain(ctx: ExplainContext): { signals: AgreementSignal[]; warnings: AgreementSignal[] };
```
Dissenters = `contributors` whose `vote` is the opposite directional side to `dominantBias`. All signal/warning codes, conditions, severities, sources, and message templates exactly per the spec's Explanation section (ids interpolated from data).

- [ ] **Step 1: Failing tests.**
  - `dominance.test.ts`: aligned layers (both bull → dominant bullish, dominantShare high); cross-layer split (ind bull 90 / cat bear 88 → dominant from combined mass with 0.4/0.6 blend → bearish, NOT forced neutral); empty category layer → indicator dominates (blend renormalizes); both empty → neutral, shares 0.
  - `explanation.test.ts`: strong bullish consensus → `AGR_STRONG_CONSENSUS` + `AGR_LAYERS_ALIGNED`; high conflict → `AGR_HIGH_CONFLICT`; layer mismatch → `AGR_LAYER_MISMATCH`; a dissenting contributor id appears in the `AGR_DISSENT` message; neutral dominance + high agreement → `AGR_NEUTRAL_DOMINANCE`; low directional share → `AGR_LOW_DIRECTION`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Releasable gate.**
- [ ] **Step 6: Commit:** `feat(mtf): M3 combined dominance + explanation`

---

## Task 4: Agreement orchestrator

**Files:**
- Create: `lib/mtf/agreement/agreementEngine.ts`
- Test: `lib/mtf/agreement/agreementEngine.test.ts`

**Interfaces:**
```ts
export const AGREEMENT_BLEND = { indicator: 0.4, category: 0.6 };
export const AGREEMENT_THRESHOLDS = { strong: 75, moderate: 55, highConflict: 50, oneSided: 0.8, lowDirection: 0.3 };
export function computeAgreement(
  indicatorResults: IndicatorResult[],
  categoryResults: CategoryResult[],
  previousAgreement?: number,
): AgreementResult;
```
Blend (renormalized for empty layers) → agreement/conflict; `combine()` → bias/shares; head-counts → votes; state machine + consensus per spec; `explain()` → signals/warnings; assemble `AgreementResult` (`schemaVersion: 1`, `agreementRatio = agreement/100`, optional `previousAgreement`/`agreementDelta`).

- [ ] **Step 1: Failing tests.**
  - Real pipeline: `createDefaultRegistry().evaluate(series(260,100,0.5))` → `computeCategoryIntelligence(...)` → `Object.values(res.categories)` → `computeAgreement(indicators, categories)`. Assert `schemaVersion === 1`; agreement/conflict in [0,100]; `dominantBias` a Verdict; `consensus` a valid label; `state` valid; every signal/warning `source` ∈ {indicator,category}; `contributors.length === 13` (7 + 6) each with `layer`.
  - Golden snapshot on a fixed synthetic input set (hand-built `IndicatorResult[]`/`CategoryResult[]`): `expect(computeAgreement(inds, cats)).toMatchInlineSnapshot(...)` (fill the snapshot from the first green run).
  - Empty candles → all-neutral inputs → `state: 'none'`, `consensus: 'none'`, `dominantBias: 'neutral'`.
  - `previousAgreement` supplied → `agreementDelta === agreement − previousAgreement`.
  - Determinism: `toEqual` twice.
  - State orthogonality: a fixture with agreement ≥ 75 AND conflict ≥ 50 → `state: 'strong'` (not conflicted).
  - **Explainability/traceability invariant:** for the real-pipeline result, (a) `contributors` ids === the set of input indicator + category ids (nothing dropped); (b) every id token appearing in any `signals`/`warnings` message is a substring match of some `contributors[].id` — no signal names a component absent from `contributors`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (fill inline snapshot).
- [ ] **Step 5: Releasable gate.**
- [ ] **Step 6: Commit:** `feat(mtf): M3 agreement orchestrator (computeAgreement)`

---

## Task 5: Final verification + memory

- [ ] `npx vitest run` → all pass (987 baseline + new M3 tests).
- [ ] `npx tsc --noEmit` → no new errors.
- [ ] `git diff --name-only <M3-base>..HEAD | grep -v '^lib/mtf/' | grep -v '^docs/'` → empty (nothing outside lib/mtf + docs).
- [ ] `graphify update .`
- [ ] Update memory `mtf-engine.md`: M3 Agreement Engine complete, architecture frozen, next = M4 Market Confidence.
- [ ] **Follow-up (deferred, post-M3):** author a canonical M0–M3 "core infrastructure" architecture doc (`docs/architecture/mtf-intelligence-pipeline.md`) describing the Indicator Registry → Indicator Intelligence → Category Intelligence → Agreement pipeline as the single reference for M4+. Not required to close M3; noted so it isn't lost. (graphify-out already covers navigation; this is the narrative companion.)

## Self-Review Notes

- **Spec coverage:** contract + vote + conflict (Task 1); layer engines (Task 2); combined dominance + explanation (Task 3); orchestrator/state/consensus/history (Task 4); invisibility/verification (Task 5). All three MTFM3review required refinements: combined-vote bias (dominance.ts, Task 3), conflict-orthogonal state (state machine, Task 4), 0.4/0.6 blend (`AGREEMENT_BLEND`, Task 4). ⭐ reserves — rich `Contributor[]`, `consensus`, `AGR_NEUTRAL_DOMINANCE`, `dominantShare`/`minorityShare`, `previousAgreement`/`agreementDelta` — all in the contract + Tasks 3–4.
- **Type consistency:** `LayerAgreement` produced by `layerAgreementOf` (vote.ts) and consumed by dominance/engine; `computeAgreement(IndicatorResult[], CategoryResult[], previousAgreement?)`; `AGREEMENT_BLEND`/`AGREEMENT_THRESHOLDS` shared from agreementEngine.ts.
- **No placeholders:** formula detail is exact in the frozen spec; tests carry concrete numbers.
