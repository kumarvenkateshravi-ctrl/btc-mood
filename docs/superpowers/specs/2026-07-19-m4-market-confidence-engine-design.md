# M4 — Market Confidence Engine

**Date:** 2026-07-19 · **Status:** Approved & frozen (MTFM4Plan brief + review + MTFM4update/1 decisions)
**Builds on:** M1 indicator intelligence, M2 category intelligence, M3 agreement (`lib/mtf/**`)
**Constitution:** `docs/architecture/market-intelligence-pipeline.md`

M3 answers "does the market agree?"; **M4 answers "can I trust that agreement enough to act?"**
Agreement ≠ Confidence: a 95%-agreement neutral market yields *low* directional confidence.
Deterministic, replay-safe, closed-bar, no React/UI, no consumers yet.

## Architectural rules

- **Consumes M1/M2/M3 outputs only** (`IndicatorResult[]`, `CategoryResult[]`, `AgreementResult`) —
  never recomputes indicators, categories, or agreement.
- **Confidence is trust, not agreement.** High agreement may still yield low confidence.
- **Everything explainable.** Every point of confidence maps to a signed contribution; the final
  number is literally the sum of its explanations (audit identity below).
- **All weights/thresholds are config** — no magic numbers in logic.
- **Semantic, but declarative (relaxed Rule 6).** M4 legitimately knows participation/quality/trend
  matter for trust, but that knowledge lives in named config maps, never hidden `if id === …`
  branching inside logic.

## Config (all tunable, JSDoc'd "conservative default; tuned later; API stable")

```ts
// Pillar blend (the base). Sums to 1.
export const CONFIDENCE_WEIGHTS = { indicator: 0.30, category: 0.35, agreement: 0.35 } as const;

// Category-aggregation weighting — DIRECTIONAL categories only (quality/volatility are
// non-directional trust modifiers handled as penalties, not base contributors). Weights sum to 1.
export const CATEGORY_CONFIDENCE_FACTORS: Record<string, { weight: number; minConfidence?: number; minStrength?: number }> = {
  trend: { weight: 0.30, minConfidence: 60 },
  momentum: { weight: 0.25 },
  volume: { weight: 0.20 },
  participation: { weight: 0.25, minStrength: 55 },
};

export const CONFIDENCE_THRESHOLDS = { veryHigh: 80, high: 65, medium: 45, low: 30 } as const;

// Orthogonal positive (data volume, NOT confidence level — not in the base).
export const CONFIDENCE_EVIDENCE = { completeness: 8 } as const;

// Orthogonal reductions (none of these are represented in the base).
export const CONFIDENCE_PENALTIES = { conflict: 15, layerMismatch: 10, quality: 12, volatility: 10, limitingFactor: 0.4 } as const;
```

## Contract (`lib/mtf/confidence/confidenceTypes.ts`)

```ts
export type ConfidenceState = 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
export type ContributionKind = 'base' | 'evidence' | 'penalty';
export type ConfidenceLayer = 'indicator' | 'category' | 'agreement';

export interface ConfidenceSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

/** Signed, auditable contribution (MTFM4update Gap 4). penalty amounts are negative. */
export interface ConfidenceContributor { id: string; layer: ConfidenceLayer; kind: ContributionKind; contribution: number; }

export interface ConfidenceResult {
  schemaVersion: 1;
  confidence: number;              // 0–100 (clamped)
  state: ConfidenceState;
  contributors: ConfidenceContributor[];
  signals: ConfidenceSignal[];
  warnings: ConfidenceSignal[];
  diagnostics: {
    indicatorConfidence: number;   // pillar values (pre-weight)
    categoryConfidence: number;
    agreementConfidence: number;
    evidence: number;              // Σ evidence contributions (≥0)
    penalties: number;             // Σ |penalty contributions| (≥0)
  };
  previousConfidence?: number;
  confidenceDelta?: number;
}
```

## Pillars

- **`indicatorConfidence(indicators): number`** = `Σ(weight·confidence) / Σ(weight)` (weight-weighted
  mean of indicator confidences); no indicators → 0.
- **`categoryConfidence(categories): number`** = weighted mean over the categories named in
  `CATEGORY_CONFIDENCE_FACTORS`, normalized by the summed weight of the *present* factor categories;
  none present → 0. Quality/volatility are excluded here (they are penalties).
- **`agreementConfidence(agreement): number`** = `round(agreement.agreement × directionalShare)` where
  `directionalShare = agreement.diagnostics.dominantShare + agreement.diagnostics.minorityShare`
  (0–1). **Decision 3:** a strong *neutral* consensus has directionalShare ≈ 0 → agreementConfidence
  ≈ 0. `state === 'none'` → ≈ 0.

## Evidence (`evidence.ts`) — orthogonal positive only

- **Data completeness** = `1 − insufficiencyRatio`, `insufficiencyRatio = silent / (indicators + categories)`.
  Silent indicator = `Object.keys(diagnostics).length === 0` (registry placeholder). Silent category
  = `strength === 0 && confidence === 50` (M2 no-evidence invariant).
- `completenessBonus = round(CONFIDENCE_EVIDENCE.completeness × completeness)`, contributor
  `{ id:'data_completeness', layer:'indicator', kind:'evidence', contribution:+bonus }` (omit when 0).
  Orthogonal to the base (volume of evidence, not its confidence/agreement).

## Penalties (`penalties.ts`) — orthogonal reductions (contribution is negative)

| id | layer | formula |
|---|---|---|
| `conflict` | agreement | `round(P.conflict × agreement.conflict / 100)` |
| `layer_mismatch` | agreement | `agreement.warnings` has `AGR_LAYER_MISMATCH` ? `P.layerMismatch` : 0 |
| `low_quality` | category | quality category present: `round(P.quality × (1 − qualityStrength/100))` |
| `high_volatility` | category | volatility category present: `round(P.volatility × volatilityStrength/100)` |
| `weak_pillar` | *weakest* | `round(P.limitingFactor × max(0, base − min(indConf, catConf, agrConf)))`; layer = weakest pillar; id names it |

`base = round(W.indicator·indConf) + round(W.category·catConf) + round(W.agreement·agrConf)`.
Each penalty omitted when 0.

## Orchestrator (`confidenceEngine.ts`)

`computeConfidence(indicatorResults, categoryResults, agreementResult, previousConfidence?): ConfidenceResult`

1. Pillars → `indConf`, `catConf`, `agrConf`.
2. Base contributors (kind `base`): `{indicator, W.indicator·indConf}`, `{category, W.category·catConf}`,
   `{agreement, W.agreement·agrConf}` (each rounded).
3. `evidence` contributors + `penalty` contributors (negative).
4. **Audit identity:** `raw = Σ all contributions`; `confidence = clamp(round(raw), 0, 100)`.
   If `raw > 100` → `CONF_CLAMPED_HIGH`; if `raw < 0` → `CONF_CLAMPED_LOW`.
5. `state` from `CONFIDENCE_THRESHOLDS` (≥80 very_high, ≥65 high, ≥45 medium, ≥30 low, else very_low).
6. `diagnostics.evidence` = Σ evidence; `diagnostics.penalties` = Σ |penalty|.
7. `previousConfidence`/`confidenceDelta` set only when supplied.

**Reconciliation test (the explainability invariant):** `Σ contributors.contribution === raw` and
`clamp(raw) === confidence`. No hidden scoring.

## Explanation (`explanation.ts`) — generic codes, data-driven messages

Signals: `CONF_STRONG` (confidence ≥ veryHigh), `CONF_HIGH_AGREEMENT` (agrConf ≥ high),
`CONF_HIGH_CATEGORY_CONFIDENCE` (catConf ≥ high), `CONF_HIGH_INDICATOR_CONFIDENCE` (indConf ≥ high),
`CONF_COMPLETE_EVIDENCE` (completeness ≥ 0.9).
Warnings: `CONF_HIGH_CONFLICT`, `CONF_WEAK_PILLAR` (names weakest layer), `CONF_LOW_QUALITY`,
`CONF_HIGH_VOLATILITY`, `CONF_LAYER_MISMATCH`, `CONF_INSUFFICIENT_EVIDENCE` (completeness < 0.5),
`CONF_WEAK_CATEGORY` (a `CATEGORY_CONFIDENCE_FACTORS` category below its `minConfidence`/`minStrength`;
message names the id — generic code, data-driven), `CONF_CLAMPED_HIGH` / `CONF_CLAMPED_LOW`.

## Files, testing, versioning

`lib/mtf/confidence/{confidenceTypes, indicatorConfidence, categoryConfidence, agreementConfidence,
evidence, penalties, explanation, confidenceEngine}.ts` + colocated `*.test.ts`. Real-pipeline test:
`registry.evaluate → computeCategoryIntelligence → computeAgreement → computeConfidence`. Coverage:
pillar formulas, evidence/penalty exactness, neutral-consensus → low confidence, weak-pillar limiter,
clamp signals, audit-identity reconciliation, determinism, golden values. `schemaVersion:1` additive-only
(per the constitution). **Releasable-per-task invariant:** every task ends with tsc clean + full suite
green + atomic commit + graph. Nothing outside `lib/mtf/**` + docs; M4 invisible (no consumers).
