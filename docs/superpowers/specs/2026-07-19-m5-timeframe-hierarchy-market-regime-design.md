# M5 — Timeframe Hierarchy + Market Regime

**Date:** 2026-07-19 · **Status:** Approved & frozen (first-cut + btwupdate/btwupdate1 decisions)
**Builds on:** M0–M4 (`lib/mtf/**`). **Constitution:** `docs/architecture/market-intelligence-pipeline.md`
**Roadmap:** M5 of M0–M10 (Market Intelligence is M8, Trend Lifecycle is M6).

M1–M4 answer "what's true on *one* timeframe?". **M5 is the first cross-timeframe engine:**
- **Market Regime** (per TF) — the *stationary* character of one timeframe.
- **Timeframe Hierarchy** — how the timeframes relate (authority, alignment, transfer) and the
  cross-TF **overallMarketState** headline.

Clean boundary with M6: **M5 answers "what is the current multi-timeframe context?"**; M6 answers
"where are we in the trend lifecycle?" (breakout→trend→pullback→continuation→exhaustion→reversal).

## Architectural rules

- **M5 core never sees candles.** It consumes `TimeframeSnapshot[]` distilled from the frozen M0–M4
  pipeline. A helper `buildTimeframeSnapshots(candlesByTf)` runs M0–M4 per TF and lives **outside** the
  core (orchestration, not logic).
- **Reuse the frozen M3 vote primitive** (`lib/mtf/agreement/vote.ts`) for timeframe voting — TFs are
  `Voter { id: tf, verdict: bias, confidence, weight }`. Same primitive, different data.
- **Configurable hierarchy** — different trading styles swap one config array, no engine changes.
- Pure, deterministic, replay-safe, `schemaVersion:1`, generic/data-driven explanation, releasable-per-task, invisible.

## Config (`lib/mtf/timeframe/config.ts`, all tunable)

```ts
/** Ordered HIGHEST → LOWEST authority. Swap for other styles (scalp/swing) with no engine change. */
export const TIMEFRAME_HIERARCHY: Timeframe[] = ['1d', '4h', '1h', '30m', '15m', '5m'];
/** Position-derived (never hardcoded per literal TF): weight = len − index; role by tier thirds. */
export function tfWeight(tf: Timeframe): number;                 // top = len, bottom = 1; unknown = 0
export function tfRole(tf: Timeframe): 'context' | 'confirmation' | 'trigger'; // top⅓ / mid⅓ / bottom⅓
export const REGIME_THRESHOLDS = { trendStrong: 55, volHigh: 65 } as const;
export const AUTHORITY = { threshold: 55, confidenceWeight: 0.6, clarityWeight: 0.4 } as const;
export const HIERARCHY_THRESHOLDS = { aligned: 65, highConflict: 50, contextStrong: 60 } as const;
```

## Contract (`lib/mtf/timeframe/timeframeTypes.ts`)

```ts
export type RegimeType = 'trending_up' | 'trending_down' | 'ranging' | 'compression' | 'expansion';

export type OverallMarketState =
  | 'bullish_continuation' | 'bullish_pullback' | 'bullish_transition'
  | 'bearish_continuation' | 'bearish_pullback' | 'bearish_transition'
  | 'reversal_risk' | 'range_bound' | 'compression' | 'expansion';

export type TimeframeRole = 'context' | 'confirmation' | 'trigger';

/** Per-TF distillation of M0–M4 — the INPUT to M5 core (no candles, no authority/alignment). */
export interface TimeframeSnapshot {
  timeframe: Timeframe;
  bias: Verdict;          // agreement.dominantBias
  agreement: number;      // agreement.agreement (0–100)
  conflict: number;       // agreement.conflict (0–100)
  confidence: number;     // confidence.confidence (0–100)
  regime: RegimeType;     // per-TF stationary regime
  regimeClarity: number;  // 0–100
}

/** Regime engine output (used by the snapshot helper). */
export interface RegimeResult {
  schemaVersion: 1;
  regime: RegimeType;
  clarity: number;
  diagnostics: { trendStrength: number; volatility: number; direction: Verdict };
  signals: TimeframeSignal[];
}

export interface TimeframeSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong'; }

export interface TimeframeEntry {
  timeframe: Timeframe;
  bias: Verdict;
  confidence: number;
  regime: RegimeType;
  regimeClarity: number;
  role: TimeframeRole;
  authority: number;       // 0–100, intrinsic (confidence + clarity)
  agreesWithHTF: boolean;  // bias matches the controller's directional bias
}

/** Hierarchy engine OUTPUT — computes authority/alignment/controller/state. */
export interface HierarchyResult {
  schemaVersion: 1;
  htfBias: Verdict;             // weighted-dominant bias across TFs (M3 vote)
  alignment: number;           // 0–100 (M3 vote agreement over TFs)
  conflict: number;            // 0–100
  controller: Timeframe;       // controlling TF (authority-selected, top-down with transfer)
  controllerAuthority: number;
  overallMarketState: OverallMarketState;
  transition: boolean;
  perTimeframe: Partial<Record<Timeframe, TimeframeEntry>>;
  contributors: Array<{ timeframe: Timeframe; bias: Verdict; confidence: number; weight: number; authority: number }>;
  signals: TimeframeSignal[];
  warnings: TimeframeSignal[];
}
```

## Market Regime engine (`regime.ts`) — per TF, stationary

`classifyRegime(trend: CategoryResult, volatility: CategoryResult): RegimeResult`:
- `trendStrong = trend.strength >= REGIME_THRESHOLDS.trendStrong`; `direction = trend.verdict`.
- `volStrong = volatility.strength >= REGIME_THRESHOLDS.volHigh`; `volState = volatility.state`.
- Classification: `trendStrong && bullish → trending_up`; `trendStrong && bearish → trending_down`;
  else `volState==='expanding' || volStrong → expansion`; `volState==='compressed' → compression`;
  else `ranging`.
- `clarity` = the strength that drove it (trend.strength when trending, volatility.strength when
  expansion/compression, else `100 − trend.strength` for ranging). Signals name the regime.

## Timeframe Hierarchy engine (`hierarchy.ts`)

`computeTimeframeHierarchy(snapshots: TimeframeSnapshot[]): HierarchyResult`.

1. **Vote (reuse M3):** Voters = `{ id: tf, verdict: bias, confidence, weight: tfWeight(tf) }`.
   `tally → agreementFrom` = `alignment`; `dominanceFrom` = `htfBias`; `conflictFrom` = `conflict`.
2. **Authority (intrinsic):** `authority[tf] = round(AUTHORITY.confidenceWeight·confidence + AUTHORITY.clarityWeight·regimeClarity)`.
3. **Controller (hybrid, transfer rule):** walk `TIMEFRAME_HIERARCHY` top→down; controller = first
   present TF with `authority ≥ AUTHORITY.threshold`; if none clear it, controller = the highest-authority
   present TF (fallback). Control "transfers down" when a higher TF loses authority.
4. **Per-TF entries:** role = `tfRole(tf)`; `agreesWithHTF` = bias matches the controller's directional bias.
5. **transition** = context-tier and trigger-tier dominant biases are both directional and opposite,
   OR `conflict ≥ HIERARCHY_THRESHOLDS.highConflict`.
6. **overallMarketState** (cross-TF composite):
   - `htfBias === 'neutral'` → controller regime `compression`/`expansion` else `range_bound`.
   - directional `htfBias` (dir = bullish|bearish): `triggerBias` = weighted-dominant bias of trigger-tier TFs.
     - trigger aligned with htfBias → `${dir}_continuation`
     - trigger opposed ∧ context strong (context authority ≥ `contextStrong`) → `${dir}_pullback`
     - trigger opposed ∧ context weak → `reversal_risk`
     - else (trigger neutral/mixed) → `${dir}_transition`
7. **Signals** (generic, data-driven): `TF_STACK_ALIGNED` (alignment ≥ aligned ∧ directional),
   `TF_CONTROLLER` (names controller + bias), `TF_STRONG_CONTEXT`.
   **Warnings:** `TF_STACK_CONFLICT` (conflict ≥ highConflict), `TF_CONTROL_TRANSFER` (controller ≠ top
   present TF — names both), `TF_LTF_DIVERGENCE` (a trigger TF disagrees with the controller),
   `TF_REVERSAL_RISK` (overallMarketState === reversal_risk). Ids interpolated from data.

## Snapshot helper (`snapshots.ts`, OUTSIDE core)

`buildTimeframeSnapshots(candlesByTf: Partial<Record<Timeframe, Candle[]>>): TimeframeSnapshot[]` — per
TF runs `createDefaultRegistry().evaluate → computeCategoryIntelligence → computeAgreement →
computeConfidence`, calls `classifyRegime(categories.trend, categories.volatility)`, assembles the
snapshot. Ordered by `TIMEFRAME_HIERARCHY`.

## Files, testing, versioning

`lib/mtf/timeframe/{timeframeTypes, config, regime, hierarchy, snapshots}.ts` + colocated tests.
Reuses `lib/mtf/agreement/vote.ts`. Real-pipeline test: `candlesByTf → buildTimeframeSnapshots →
computeTimeframeHierarchy`. Coverage: config derivation (weight/role), each regime, vote/alignment,
authority + controller transfer, overallMarketState cases (continuation/pullback/transition/reversal_risk/
range), transition flag, explanation traceability, determinism. `schemaVersion:1` additive-only.

**M6-facing durable surface** (freeze now, don't churn later): `htfBias`, `alignment`, `conflict`,
`controller`, `authority` (per-TF), `overallMarketState`, `transition`, per-TF `regime`. M6 consumes
`TimeframeSnapshot[]` + `HierarchyResult` without reopening M5.

**Releasable-per-task invariant:** every task ends with tsc clean + full suite green + atomic commit +
graph. Nothing outside `lib/mtf/**` + docs; M5 invisible (no consumers).
