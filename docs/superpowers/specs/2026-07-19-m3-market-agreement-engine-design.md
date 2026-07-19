# M3 — Market Agreement Engine

**Date:** 2026-07-19 · **Status:** Approved & frozen (MTFM3Plan.md brief + MTFM3review.md refinements)
**Builds on:** M1 indicator intelligence, M2 category intelligence (`lib/mtf/**`)

M0 built the foundation; M1 made indicators intelligent; M2 made categories intelligent.
**M3 answers "how much does the market agree with itself?"** — the output is **Agreement**,
not Confidence (M4 owns Confidence). Fully deterministic, replay-safe, closed-bar, no
React/UI, nothing consumes it yet.

## Architectural law (from the brief + review — non-negotiable)

The Agreement Engine is **completely unaware of specific indicators or categories**. It
never contains `if EMA…` or `if Trend…`. It consumes generic **voters** — anything with
`{ id, verdict, confidence, weight? }` — using only public properties. Adding VWAP,
Ichimoku, Smart Money, or new categories requires **zero** engine changes. It never
recomputes; it only consumes M1/M2 outputs.

```
Indicators (M1) → Categories (M2) → Agreement (M3) → Confidence (M4) → Market Intel (M5)
```

## Contract (`lib/mtf/agreement/agreementTypes.ts`)

```ts
import type { Verdict } from '../types';

/** Anything M3 can count. Both IndicatorResult and CategoryResult satisfy this. */
export interface Voter { id: string; verdict: Verdict; confidence: number; weight?: number }

export type AgreementState = 'strong' | 'moderate' | 'weak' | 'conflicted' | 'none';

/** What the UI should display (strength × direction). */
export type ConsensusLabel =
  | 'strong_bullish' | 'moderate_bullish' | 'weak_bullish'
  | 'strong_bearish' | 'moderate_bearish' | 'weak_bearish'
  | 'strong_neutral' | 'moderate_neutral' | 'weak_neutral'
  | 'none';

export type ContributorLayer = 'indicator' | 'category';

/** Enriched contributor (MTFM3review #4 — reserved now to avoid API churn). */
export interface Contributor {
  id: string;
  layer: ContributorLayer;
  vote: Verdict;
  /** Effective tally weight: (weight ?? 1) × confidence. */
  weight: number;
}

export interface AgreementSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
  source: ContributorLayer;
}

export interface AgreementDiagnostics {
  /** Unweighted head-counts across ALL contributors (indicators + categories). */
  bullishVotes: number;
  bearishVotes: number;
  neutralVotes: number;
  /** agreement / 100. */
  agreementRatio: number;
  /** Larger directional side, fraction of the combined vote 0–1 (MTFM3review #1). */
  dominantShare: number;
  /** Smaller directional side, fraction of the combined vote 0–1. */
  minorityShare: number;
}

export interface AgreementResult {
  schemaVersion: 1;
  agreement: number;          // 0–100 (blended)
  conflict: number;           // 0–100, INDEPENDENT metric (not 100−agreement)
  dominantBias: Verdict;      // from COMBINED weighted vote (MTFM3review #1)
  state: AgreementState;      // agreement quality; conflict does NOT override it
  consensus: ConsensusLabel;  // strength × direction, for display (MTFM3review #7)
  indicatorAgreement: number;
  categoryAgreement: number;
  contributors: Contributor[];
  signals: AgreementSignal[];
  warnings: AgreementSignal[];
  diagnostics: AgreementDiagnostics;
  /** Reserved trend-tracking (MTFM3review): set only when a previous value is supplied. */
  previousAgreement?: number;
  agreementDelta?: number;
}

/** Internal per-layer result (not part of the public contract but exported for the engine). */
export interface LayerAgreement {
  agreement: number;
  conflict: number;
  dominantBias: Verdict;
  bull: number; bear: number; neutral: number; total: number; // weighted masses
  bullFrac: number; bearFrac: number; neutralFrac: number;     // normalized; total 0 → all 0
  contributors: Contributor[];
}
```

## Shared primitives

**`vote.ts` — the generic tally (never names anything):**
- `tally(voters: Voter[])`: weighted masses `bull/bear/neutral` where each voter adds
  `(weight ?? 1) × confidence` to its `verdict` bucket; `total = bull+bear+neutral`;
  `*Frac` = mass/total (0 when total 0).
- `agreementFrom(t)`: `total > 0 ? round(clamp(max(bull,bear,neutral)/total·100,0,100)) : 0`.
  Neutral is in the denominator (Decision 1: neutral = lack of conviction, dilutes agreement).
- `dominanceFrom(t)`: `bull>bear && bull>=neutral → 'bullish'`; `bear>bull && bear>=neutral →
  'bearish'`; else `'neutral'` (ties and neutral-max resolve to neutral).
- `contributorsOf(voters, layer)`: `{ id, layer, vote: verdict, weight: (weight??1)×confidence }[]`.

**`conflict.ts` — independent conflict (brief formula, clamped per MTFM3review #2):**
```
conflictFrom(bull, bear, total):
  const dir = bull + bear;
  if (dir <= 0 || total <= 0) return 0;
  const balance  = 1 - Math.abs(bull - bear) / dir;   // 0 one-sided … 1 evenly split
  const dirShare = dir / total;                        // scale down when mostly neutral
  return round(clamp(balance * dirShare * 100, 0, 100));
```
- 49/48/3 → ~96 · 95/5 → ~10 · all-bull → 0 · all-neutral → 0.

## Layer engines

- **`indicatorAgreement.ts`** — `indicatorAgreement(indicators: IndicatorResult[]): LayerAgreement`.
  Maps each to a `Voter` (its own `weight × confidence`), tallies, assembles `LayerAgreement`
  (agreement, `conflictFrom(bull,bear,total)`, `dominanceFrom`, fractions, `contributorsOf(…,
  'indicator')`).
- **`categoryAgreement.ts`** — same for `CategoryResult[]`; categories have no `weight` → 1, so
  they vote by confidence alone; layer `'category'`. Non-directional categories (volatility,
  quality) legitimately vote neutral — generic and correct.

## Combined dominance (`dominance.ts` — MTFM3review #1, no winner-blending)

```
combine(ind, cat, blend):                       // blend = { indicator, category }, tunable
  // renormalize when a layer is empty (total 0)
  let wi = ind.total > 0 ? blend.indicator : 0;
  let wc = cat.total > 0 ? blend.category : 0;
  if (wi + wc === 0) → { dominantBias:'neutral', bull:0, bear:0, neutral:0, dominantShare:0, minorityShare:0 }
  const s = wi + wc; wi/=s; wc/=s;
  const bull    = wi·ind.bullFrac    + wc·cat.bullFrac;
  const bear    = wi·ind.bearFrac    + wc·cat.bearFrac;
  const neutral = wi·ind.neutralFrac + wc·cat.neutralFrac;   // sums to 1
  dominantBias  = dominanceFrom({ bull, bear, neutral, total: 1 });
  dominantShare = round2(max(bull, bear));   // larger directional side
  minorityShare = round2(min(bull, bear));
```
`dominantBias` comes from the **combined weighted vote** — a genuine cross-layer split lands
in `conflict`/warnings, not a forced-neutral bias.

## Orchestrator (`agreementEngine.ts`)

`computeAgreement(indicatorResults: IndicatorResult[], categoryResults: CategoryResult[],
previousAgreement?: number): AgreementResult`

```
/** Default blend: categories are aggregated intelligence → slightly more influence (MTFM3review #3). */
export const AGREEMENT_BLEND = { indicator: 0.4, category: 0.6 };
export const AGREEMENT_THRESHOLDS = { strong: 75, moderate: 55, highConflict: 50, oneSided: 0.8, lowDirection: 0.3 };
```
1. `ind = indicatorAgreement(indicatorResults)`; `cat = categoryAgreement(categoryResults)`.
2. Renormalized blend weights `wi, wc` (empty layer → all weight to the other).
3. `agreement = round(clamp(wi·ind.agreement + wc·cat.agreement, 0, 100))`;
   `conflict  = round(clamp(wi·ind.conflict  + wc·cat.conflict,  0, 100))`.
4. `combined = combine(ind, cat, blend)` → `dominantBias`, `dominantShare`, `minorityShare`.
5. `contributors = [...ind.contributors, ...cat.contributors]`.
6. Head-counts across all contributors → `bullishVotes / bearishVotes / neutralVotes`.
7. **State** (MTFM3review #2 — conflict is orthogonal, low precedence):
   ```
   if (bullishVotes === 0 && bearishVotes === 0) 'none';
   else if (agreement >= 75) 'strong';
   else if (agreement >= 55) 'moderate';
   else if (conflict  >= 50) 'conflicted';   // low agreement caused by a split
   else 'weak';
   ```
   A strong consensus with high conflict reports `state:'strong'` + `conflict:55` — never overwritten.
8. **Consensus** = `state === 'none' ? 'none' : ${strength}_${dominantBias}` where
   `strength = agreement>=75 ? 'strong' : agreement>=55 ? 'moderate' : 'weak'`.
9. `signals`/`warnings` from `explanation.ts`.
10. `agreementRatio = agreement/100`; if `previousAgreement != null` set `previousAgreement`
    and `agreementDelta = agreement − previousAgreement`.

## Explanation (`explanation.ts` — generic, data-driven)

Codes are pattern-based; component names come from contributor `id`s (never hardcoded).
Dissenters = contributors voting the opposite directional side to `dominantBias`.

Signals:
- `AGR_STRONG_CONSENSUS` — agreement≥75 ∧ dominantBias directional; strong; source = higher-agreement layer; "Strong &lt;bias&gt; consensus across indicators and categories."
- `AGR_LAYERS_ALIGNED` — ind.dominantBias === cat.dominantBias ∧ directional; info; "Indicators and categories agree (&lt;bias&gt;)."
- `AGR_ONE_SIDED` — dominantShare ≥ 0.8; strong; "One-sided positioning."
- `AGR_NEUTRAL_DOMINANCE` — dominantBias === 'neutral' ∧ agreement ≥ 75; info; "Strong neutral consensus." (MTFM3review #5)

Warnings:
- `AGR_HIGH_CONFLICT` — conflict ≥ 50; warning; "Directional votes are evenly split."
- `AGR_LAYER_MISMATCH` — ind & cat dominant bias both directional and different; warning; source 'category'; "Indicators and categories disagree (&lt;ind&gt; vs &lt;cat&gt;)."
- `AGR_DISSENT` — dissenters exist; warning; source 'indicator' if any indicator dissenter else 'category'; message lists their ids: "&lt;ids&gt; diverge from the &lt;bias&gt; consensus."
- `AGR_LOW_DIRECTION` — state ≠ 'none' ∧ (dominantShare + minorityShare) < 0.3; warning; "Little directional conviction."

## Schema versioning policy

`schemaVersion: 1` is a literal type. **v1 permits additive changes only** (new optional
fields, new signal/warning codes, new enum members). Any change that removes or retypes an
existing field, or changes the meaning of an existing number, **requires `schemaVersion++`**
and a migration note here. Consumers may branch on `schemaVersion` but must tolerate unknown
additive fields. This keeps M4+ safe against accidental breakage.

## Explainability invariant

Every computed field in `AgreementResult` is **deterministically traceable** from the same
result — no value exists that can't be explained from its siblings:
- `agreement` / `conflict` / `dominantBias` ← `contributors[] { id, layer, vote, weight }`
  (the exact weighted inputs) + `diagnostics` (`dominantShare`, `minorityShare`, head-counts).
- `signals` / `warnings` are the human-readable "why", and any component id they name **must**
  appear in `contributors` (enforced by a traceability test).
- `contributors` covers **every** input voter (indicators + categories) — nothing is dropped
  silently. This invariant is what makes the M5 AI narration layer possible without
  reverse-engineering the engine.

## Files & testing

`lib/mtf/agreement/{agreementTypes,vote,conflict,indicatorAgreement,categoryAgreement,dominance,explanation,agreementEngine}.ts`
+ colocated `*.test.ts`. Coverage: brief scenarios (all-bull / all-bear / mixed / mostly-neutral
/ no-evidence per layer; conflict high-vs-low; dominance bull/bear/tie/neutral; explanation
matches inputs) + orchestrator golden snapshots + determinism (real M1→M2→M3 pipeline via
`createDefaultRegistry().evaluate(candles)` → `computeCategoryIntelligence` → `computeAgreement`).

## Acceptance

Pure, deterministic, replay-safe, closed-bar, no React/UI. **Releasable-per-task invariant**
(user-mandated): every task ends with ✅ `tsc` clean (no new errors) ✅ full suite green ✅ no
observable behavior change ✅ one atomic commit ✅ graph updated. Nothing outside `lib/mtf/**`
+ docs touched; M3 invisible (no consumers yet).
