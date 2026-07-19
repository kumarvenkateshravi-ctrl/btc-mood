# M7 — Probability Engine

**Date:** 2026-07-19 · **Status:** Approved & frozen (first-cut + MTFPlanM7 hybrid; expectedRR/executionQuality
deliberately excluded — see §Opportunity)
**Builds on:** M6 (`lib/mtf/lifecycle/**`), M5 (`lib/mtf/timeframe/**`). **Constitution:** `docs/architecture/market-intelligence-pipeline.md`
**Roadmap:** M7 of M0–M10.

Estimate the probability distribution of future market outcomes from the complete intelligence stack —
**deterministic, explainable, and honest about the source of those probabilities. M7 never predicts price.**

## Laws

1. **Confidence ≠ Probability.** Confidence = "how much do I trust my analysis?" (M4/M6). Probability =
   "given this analysis, the likelihood of each outcome" (M7).
2. **Probability is a model estimate, not a prediction.** No historical transition database exists yet, so
   v1 is **explicitly `calibration: 'prior'`** — conservative model priors, never presented as measured
   frequencies. A permanent `PROB_MODEL_PRIORS` signal states this on every result.
3. **Calibration is built in, not bolted on.** `priors.ts` is the single swap point: when replay/backtesting
   later measures real stage-transition frequencies, the empirical matrix replaces the priors and
   `calibration/sampleSize/modelVersion` report it — **zero contract change**.
4. **Multiplicative audit identity.** Every probability is `prior × Π(named factors) / Z`. Contributors
   record `{ outcome, source, factor }`; a test reconstructs the final distribution from the contributors.
   (An additive decomposition does not survive normalization; multiplicative is the honest form.)

## Inputs / boundary

`computeProbability(lifecycle: TrendLifecycleResult, hierarchy: HierarchyResult): ProbabilityResult`.
No candles, indicators, categories, or raw agreement/confidence — those are already interpreted upstream
(agreement/conflict/alignment live on `HierarchyResult`; snapshot confidence is folded into
`stageConfidence`/`nextStageConfidence`). **M8 consumes only `ProbabilityResult`.**

## Contract (`lib/mtf/probability/probabilityTypes.ts`)

```ts
export type TransitionOutcome = 'advance' | 'stay' | 'regress' | 'break';
export type OutcomeDirection = 'bullish' | 'bearish' | 'sideways';
export type MarketOutcome = 'continuation' | 'pullback' | 'range' | 'reversal' | 'false_breakout' | 'expansion';
export type OpportunityGrade = 'A' | 'B' | 'C' | 'D';

export interface TransitionProbability { outcome: TransitionOutcome; stage: TrendStage; probability: number }
export interface DirectionalProbability { direction: OutcomeDirection; probability: number }
export interface OutcomeProbability { outcome: MarketOutcome; probability: number }
export interface ProbabilityContributor { layer: 'transition' | 'directional' | 'outcome'; outcome: string; source: string; factor: number }
export interface ProbabilitySignal { code: string; message: string; severity: 'info' | 'warning' | 'strong' }

export interface ProbabilityResult {
  schemaVersion: 1;
  calibration: 'prior' | 'empirical';   // v1: ALWAYS 'prior'
  modelVersion: string;                 // '1.0'
  sampleSize?: number;                  // reserved — populated when empirical
  confidenceInterval?: number;          // reserved — MUST stay undefined while calibration === 'prior'
  stageTransitions: TransitionProbability[];  // Σ = 1
  directional: DirectionalProbability[];      // Σ = 1
  marketOutcomes: OutcomeProbability[];       // Σ = 1 — the trader-facing layer
  dominantTransition: TransitionProbability;
  dominantDirection: DirectionalProbability;
  mostLikelyOutcome: OutcomeProbability;
  /** Distribution ACTIONABILITY (concentration × direction clarity) — NOT trade quality.
   *  expectedRR / execution quality are M9's job: they require price levels M7 cannot see. */
  opportunity: { score: number; grade: OpportunityGrade };
  contributors: ProbabilityContributor[];     // multiplicative audit trail
  signals: ProbabilitySignal[];
  warnings: ProbabilitySignal[];
}
```
Probabilities are 0–1 floats (rounded 4 dp); each layer's Σ ∈ [0.99, 1.01] (rounding tolerance, tested).

## Config (`config.ts` + `priors.ts`, all tunable — "conservative default; tuned later; API stable")

```ts
// priors.ts — THE calibration swap point (model priors today, empirical matrix later).
export const PROBABILITY_MODEL_VERSION = '1.0';
export const TRANSITION_PRIORS: Record<TransitionOutcome, number> = { advance: 0.45, stay: 0.30, regress: 0.15, break: 0.10 };
export const TRANSITION_PRIOR_OVERRIDES: Partial<Record<TrendStage, Partial<Record<TransitionOutcome, number>>>> = {
  exhaustion: { advance: 0.55, stay: 0.20, regress: 0.10, break: 0.15 },   // exhausted trends roll forward
  reversal: { advance: 0.50, stay: 0.25, regress: 0.10, break: 0.15 },
  range: { advance: 0.35, stay: 0.45, regress: 0.05, break: 0.15 },        // ranges persist
};

// config.ts — adjustment factors + thresholds.
export const PROB_FACTORS = {
  confSharpen: 0.8,      // advance ×(1 + f·(nextStageConfidence−50)/100)
  invalidation: 0.5,     // invalidated: advance ×(1−f); regress, break ×(1+f)
  trajectoryRegress: 0.4,// trajectory 'regressing': regress ×(1+f)
  exhaustionBreak: 0.6,  // exhaustion ≥ 70: break ×(1 + f·exhaustion/100)
  strengthAdvance: 0.4,  // advance ×(1 + f·(lifecycleStrength−50)/100)
  freshnessStay: 0.3,    // stay ×(1 + f·(freshness−50)/100)
  dirAlignment: 1.0,     // htfBias side ×(1 + f·alignment/100)
  dirConflict: 1.0,      // sideways ×(1 + f·conflict/100)
  dirLifecycle: 0.5,     // lifecycle.direction side ×(1 + f·lifecycleStrength/100)
  dirRangeStage: 0.5,    // stage ∈ {range, accumulation, distribution}: sideways ×(1+f)
  outDirection: 0.5,     // continuation ×(1 + f·P(bias dir)); reversal ×(1 + f·P(opposite dir)); range ×(1 + f·P(sideways))
} as const;
export const PROB_THRESHOLDS = { highConviction: 0.65, uncertain: 0.40, reversalElevated: 0.25 } as const;
export const OPPORTUNITY_GRADES = { A: 80, B: 65, C: 45 } as const;   // D below C
```

## Layer 1 — Transition engine (`transitions.ts`)

`transitionProbabilities(lifecycle): { distribution: TransitionProbability[]; contributors }`.
Target stages: `advance → expectation.expected` · `stay → stage` · `regress → CYCLE_ORDER[i−1]` (off-cycle
or index 0 → `'range'`) · `break → 'reversal'`. Start from `TRANSITION_PRIORS` (+ per-stage overrides);
apply the multiplicative factors above (each recorded as a contributor; factors of exactly 1 are omitted);
normalize to Σ=1.

## Layer 2 — Directional engine (`directional.ts`)

`directionalProbabilities(lifecycle, hierarchy)`. Prior ⅓/⅓/⅓; apply `dirAlignment` (htfBias side),
`dirConflict` (sideways), `dirLifecycle` (lifecycle.direction side, when directional), `dirRangeStage`
(sideways); normalize. Contributors recorded.

## Layer 3 — Market outcome engine (`outcomes.ts`) — the trader-facing layer

`marketOutcomeProbabilities(transitions, directional, lifecycle)`. Each transition's mass lands in the
bucket of its **target stage**:

| bucket | target stages |
|---|---|
| `expansion` | breakout |
| `continuation` | confirmation, trend_establishment, continuation |
| `pullback` | healthy_pullback |
| `reversal` | exhaustion, distribution, reversal |
| `range` | range, accumulation |

**False-breakout override:** when `lifecycle.stage ∈ {breakout, confirmation}`, `regress`/`break` mass →
`false_breakout` (instead of its generic bucket). Then three directional modulations (`outDirection`):
`continuation ×(1 + f·P(bias dir))`, `reversal ×(1 + f·P(opposite dir))`, `range ×(1 + f·P(sideways))` —
where "bias dir" = lifecycle.direction when directional, else no modulation. Normalize. Contributors recorded.
Only buckets with mass appear in `marketOutcomes` (empty buckets omitted).

## Opportunity (`opportunity.ts`) — deliberately minimal

`opportunityOf(mostLikelyOutcome, dominantDirection): { score; grade }` =
`score = round(100·(0.6·P(mostLikelyOutcome) + 0.4·P(dominantDirection)))`; grade by `OPPORTUNITY_GRADES`.
**Explicitly distribution actionability.** `expectedRR` and `executionQuality` are EXCLUDED by design:
they require price levels (entry/stop/target) that M7 cannot see — M9 (Trade Decision, with price context)
owns them. Emitting an RR from stage probabilities alone would be fake precision.

## Explanation (`explanation.ts`)

Signals: `PROB_MODEL_PRIORS` (permanent while `calibration==='prior'`, info — "Estimates from model priors,
not measured frequencies."), `PROB_HIGH_CONVICTION` (mostLikelyOutcome ≥ .65, strong).
Warnings: `PROB_UNCERTAIN` (mostLikelyOutcome < .40), `PROB_REVERSAL_ELEVATED` (reversal or false_breakout
≥ .25).

## Orchestrator (`probabilityEngine.ts`)

transitions → directional → outcomes → opportunity → explanation → assemble (`calibration:'prior'`,
`modelVersion`, `sampleSize: 0`, dominants = argmax per layer, contributors concatenated).

## Files, testing, acceptance

`lib/mtf/probability/{probabilityTypes, config, priors, transitions, directional, outcomes, opportunity,
explanation, probabilityEngine}.ts` + colocated tests (a tiny shared `normalize()` lives in `transitions.ts`'s
module or a `shared.ts` — implementation detail). Coverage: priors + overrides; every adjustment factor with
hand-computed values; normalization Σ tolerance; the **audit-reconstruction test** (`prior × Πfactors / Z`
reproduces each layer's distribution); false-breakout override; opportunity score/grade bands; signals;
real **M0→M7 pipeline** test (`buildTimeframeSnapshots → computeTimeframeHierarchy → computeTrendLifecycle →
computeProbability`); empty/degenerate input safe; determinism; golden values.

Pure, deterministic, replay-safe, no UI, no consumers yet. **Releasable-per-task invariant.** Nothing outside
`lib/mtf/**` + docs. **M8-facing surface:** the entire `ProbabilityResult` (M8 consumes only this).
`schemaVersion:1` additive-only; `calibration/sampleSize/confidenceInterval/modelVersion` reserved for
empirical calibration.
