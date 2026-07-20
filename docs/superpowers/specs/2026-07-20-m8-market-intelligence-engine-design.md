# M8 — Market Intelligence Engine

**Date:** 2026-07-20 · **Status:** Approved & frozen (first-cut + MTFM8plan hybrid; conviction score
dropped in favor of structured Quality/Opportunity/Risk/Readiness; timestamps/execution-time excluded
for determinism)
**Builds on:** Intelligence Platform v1.0 (M0–M7, permanently frozen). **Constitution:** `docs/architecture/market-intelligence-pipeline.md`
**Roadmap:** M8 of M0–M10.

M8 is **NOT another analysis engine** — it is the **Institutional Intelligence Synthesizer** ("CEO
dashboard"): it collects the frozen v1.0 outputs and produces the one complete picture that the UI,
alerts, AI narration, reports, and M9 consume. **Single source of truth.**

## Rules

1. **Never recalculates anything.** Consumes exactly five frozen result objects: `AgreementResult`,
   `ConfidenceResult`, `HierarchyResult`, `TrendLifecycleResult`, `ProbabilityResult`. (This resolves the
   MTFPlanM7 "only ProbabilityResult" line: that constraint applies to the M7 edge — from M7, consume only
   its result — not to the other frozen surfaces.)
2. Deterministic — same inputs ⇒ identical output. **No timestamps, no execution-time fields** (callers
   stamp at call time if needed).
3. No hidden scoring: every displayed value derives from named v1.0 fields via documented config formulas.
4. No duplicated logic. 5. Every statement traceable (evidence/reasons carry layer sources).
6. **Readiness is an ENVIRONMENT GATE, not a trade decision** — no direction, entry, size, or RR (M9 owns
   those; M9 consumes readiness as an input).

## Contract (`lib/mtf/market/marketTypes.ts`)

```ts
export type LayerTag = 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';
export type QualityLevel = 'excellent' | 'good' | 'average' | 'poor' | 'dangerous';
export type MarketGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'extreme';
export type ReadinessState = 'ready' | 'wait' | 'no_trade' | 'avoid';

export interface EvidenceItem { source: LayerTag; text: string }
export interface UnifiedSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; source: LayerTag }

export interface MarketIntelligenceResult {
  schemaVersion: 1;
  headline: {
    bias: Verdict;                       // hierarchy.htfBias
    state: OverallMarketState;           // hierarchy.overallMarketState
    controller: Timeframe;               // hierarchy.controller
    regime: RegimeType;                  // hierarchy.perTimeframe[controller].regime (fallback 'ranging')
    stage: TrendStage;                   // lifecycle.stage
    mostLikelyOutcome: MarketOutcome;    // probability.mostLikelyOutcome
    outcomeProbability: number;
    calibration: 'prior' | 'empirical';  // propagated M7 honesty flag — never hidden
  };
  quality: { score: number; level: QualityLevel; reasons: string[] };
  opportunity: { score: number; grade: MarketGrade };
  risk: { score: number; level: RiskLevel; reasons: string[] };
  readiness: { state: ReadinessState; reason: string };   // environment gate only (Rule 6)
  evidence: { supporting: EvidenceItem[]; opposing: EvidenceItem[] };
  outlook: {                             // derivable fields ONLY (no price levels, no "next controller")
    expectedStage: TrendStage; rationale: string; nextStageConfidence: number;
    marketOutcomes: OutcomeProbability[];               // the full M7 trader layer
    invalidation: { invalidated: boolean; condition: string | null };  // M6 as-is
    transition: boolean;                                 // M5 flag
  };
  narrative: string[];                   // deterministic template sentences (executive summary; AI expands later)
  signals: UnifiedSignal[];              // M3–M7 (+M8) merged, deduped by code, sorted strong→warning→info
  warnings: UnifiedSignal[];
  diagnostics: {                         // developer snapshot — no timing fields
    schemaVersions: { agreement: number; confidence: number; hierarchy: number; lifecycle: number; probability: number };
    calibration: 'prior' | 'empirical'; modelVersion: string;
    scores: { agreement: number; confidence: number; alignment: number; conflict: number;
              lifecycleStrength: number; probabilityOpportunity: number };
  };
}

computeMarketIntelligence(agreement, confidence, hierarchy, lifecycle, probability): MarketIntelligenceResult
computeFullMarketIntelligence(candlesByTf): { result: MarketIntelligenceResult; layers: { snapshots; hierarchy; lifecycle; agreement; confidence; probability } }
```
`computeFullMarketIntelligence` is the **single public entry point**: runs the frozen v1.0 stack per the
controller path (`buildTimeframeSnapshots → computeTimeframeHierarchy → computeTrendLifecycle`, plus
M1→M4 on the controller TF's closed candles for agreement/confidence, then `computeProbability`) and
returns both the synthesis and the layer objects. Pure composition, no logic.

## Config (`config.ts`, all tunable — "conservative default; tuned later; API stable")

```ts
export const QUALITY_WEIGHTS = { confidence: 0.30, agreement: 0.25, alignment: 0.20, lifecycleStrength: 0.15, calm: 0.10 } as const; // calm = 100 − conflict
export const QUALITY_BANDS = { excellent: 80, good: 65, average: 45, poor: 30 } as const;               // dangerous below poor
export const OPP_WEIGHTS = { agreement: 0.30, confidence: 0.25, outcomeProb: 0.25, lifecycleStrength: 0.10, m7Opportunity: 0.10 } as const;
export const OPP_GRADES = { 'A+': 90, A: 80, B: 65, C: 50, D: 35 } as const;                            // F below D
export const RISK_POINTS = { conflict: 25, transition: 15, reversalRisk: 20, weakController: 10, lowConfidence: 20, invalidated: 10, priorCalibration: 5, expansionRegime: 10 } as const;
export const RISK_BANDS = { veryLow: 15, low: 30, medium: 50, high: 70 } as const;                      // extreme ≥ high
export const READINESS = { minQuality: 'good', minGrade: 'B', maxRisk: 'medium' } as const;
```

## Blocks (exact formulas)

**Quality** (non-directional health): `score = round(Wq.confidence·confidence + Wq.agreement·agreement +
Wq.alignment·alignment + Wq.lifecycleStrength·lifecycleStrength + Wq.calm·(100−conflict))`; level by
`QUALITY_BANDS`. `reasons` = per-component sentences for components ≥65 ("strong …") or ≤35 ("weak …").

**Opportunity** (market-level; consumes M7's distribution-level opportunity as ONE input):
`score = round(Wo.agreement·agreement + Wo.confidence·confidence + Wo.outcomeProb·(100·P(mostLikely)) +
Wo.lifecycleStrength·lifecycleStrength + Wo.m7Opportunity·probability.opportunity.score)`; grade by
`OPP_GRADES`. No price, no RR, no entry (M9).

**Risk** (environment): additive named points → `score = clamp(Σ, 0, 100)`; each contributing factor
becomes a reason. Factors: `round(P.conflict·conflict/100)`; `transition → P.transition`;
`overallMarketState==='reversal_risk' → P.reversalRisk`; `controllerAuthority < 55 → P.weakController`;
`round(P.lowConfidence·(100−confidence)/100)`; `lifecycle.invalidation.invalidated → P.invalidated`;
`calibration==='prior' → P.priorCalibration`; controller regime `expansion → P.expansionRegime`.
Level by `RISK_BANDS`.

**Readiness** (first-match ladder; reason names the deciding rule):
1. `avoid` — risk level high/extreme ∨ quality dangerous ∨ state reversal_risk
2. `no_trade` — quality poor ∨ dominantDirection === 'sideways'
3. `ready` — quality ≥ good ∧ grade ≥ B ∧ risk ≤ medium
4. `wait` — everything else (needs confirmation)

**Evidence** (rule-per-layer, template text, source-tagged): supporting — agreement ≥65 (M3), confidence
≥65 (M4), alignment ≥65 + controller named (M5), trending stage ∧ lifecycleStrength ≥55 (M6),
P(mostLikely) ≥ .50 (M7). Opposing — conflict ≥40 (M3), confidence <45 (M4), transition (M5),
invalidated ∨ exhaustion ≥70 (M6), reversal/false_breakout ≥ .25 (M7).

**Narrative** (ordered deterministic templates; banned-vocabulary test — no likely/will/expected/should/
forecast/anticipate/predict; probability phrased as "currently favors"): controller sentence → state
sentence → agreement/confidence sentence → probability sentence → quality/opportunity sentence →
readiness sentence.

**Unified signals**: merge M3–M7 signals/warnings (+ M8's own readiness/risk notes) into `UnifiedSignal`
with `source` layer tag; dedupe by `code` (first wins); sort severity strong → warning → info. M2
category signals are NOT included (not in the five inputs — documented limitation; they surface
transitively via M3 contributors).

## Files, testing, acceptance

`lib/mtf/market/{marketTypes, config, quality, opportunity, risk, readiness, evidence, narrative,
unifiedSignals, marketEngine}.ts` + colocated tests. (Headline/outlook/diagnostics are pure projections
assembled in `marketEngine.ts` — not separate modules.) Coverage: every formula with hand-computed
values; every band/grade/ladder boundary; evidence rule per layer; narrative determinism + banned
vocabulary; dedupe/sort; **real M0→M8 pipeline** via `computeFullMarketIntelligence`; determinism;
empty candles safe; traceability (every evidence source ∈ LayerTag; every reason non-empty).

Pure, deterministic, replay-safe, no UI, no consumers yet. **Releasable-per-task invariant.** Nothing
outside `lib/mtf/**` + docs. **M9-facing surface:** the entire `MarketIntelligenceResult` +
`computeFullMarketIntelligence`. `schemaVersion:1` additive-only. Platform v1.0 contracts untouched.
