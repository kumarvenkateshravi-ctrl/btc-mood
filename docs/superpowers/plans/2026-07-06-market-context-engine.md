# Market Context Engine — MTF Confirmation for Signals (Plan, rev. 2)

> Status: APPROVED architecture (revisedMTF.md, 9.8/10) with 12 refinements applied.
> Source: MTFPlan.md Sprints 1–5 + chart widget; backtest/analytics = next plan.

**Goal:** Buy/Sell signals confirmed by the Multi-Timeframe alignment
(indicators × {5m,15m,30m,1h,4h,1d}) via a pure **Market Context Engine**:
`Zones → Market Context → Decision → BUY/SELL`, everything scored 0–100,
explainable, and **configuration-driven end to end**.

---

## 1. Assessment (unchanged from rev. 1)

MTF confirmation is the highest-value gate, but the existing MTF page data cannot be
used as-is; the engine fixes three defects: (1) it is UI-layer live-bar data →
**pure `lib/context/`, closed bars only** (non-repaint is the product promise:
*"if we generate a signal, it will never disappear"*); (2) `indicatorRows`' "last
non-neutral signal" never expires → **recency decay**; (3) the table only covers
toggled-on indicators → **fixed 7-indicator roster** independent of chart state.
No new indicators (indicator freeze); everything reuses the engines already built.

## 2. Revisions applied (revisedMTF.md — all 12)

1. **No hardcoded indicator weights** — typed `ContextWeights`, defaults only.
2. **No hardcoded TF weights** — typed `TimeframeWeights`, defaults only.
3. **No binary 4H+1D veto** — weighted **higher-TF agreement score** (0–100) with a
   configurable floor; markets transition gradually.
4. **Neutral is a first-class bias** — the engine may say "I don't know"
   (neutral band around 50, configurable).
5. **Conflict detection** — `conflictScore` 0–100 (indicator disagreement).
6. **Confidence ≠ Context** — separate `confidence` (agreement × data sufficiency):
   context can be bullish while confidence is low.
7. **Dynamic zone weighting** — zone weight in the decision scales with zone
   confidence (20% → 45%), other weights renormalize.
8. **Signal quality grades** — A+ (Institutional) / A (Strong) / B (Moderate) /
   C (Aggressive) / D (High Risk) from the decision score.
9. **Risk profile per signal** — low/medium/high from SL distance, volatility,
   trend alignment, conflict.
10. **Explain WHY NOT** — rejected candidates return structured rejection reasons
    ("❌ 1D trend bearish · ❌ weak volume · context 58 < 65").
11. **Decision formula redesigned** — Trend/Momentum/Volume become independent
    terms (no longer hidden inside Context):
    Context 30 · Zone 25 · Trend 15 · Momentum 10 · Volume 10 · Risk 5 · Liquidity 5.
12. **Future-proof registry** — indicator scorers are pluggable
    `ContextScoreProducer`s; adding VWAP / funding / OI later changes zero
    Decision-Engine code.

---

## 3. Architecture (`lib/context/` — pure, no UI/chart/store imports)

```
types.ts            contracts + ALL config interfaces (weights, thresholds, bands)
indicatorScores.ts  ContextScoreProducer registry: 7 adapters over existing lib code
trendEngine.ts      EMA + Supertrend + HH/HL structure + ADX  → trendScore 0-100
momentumEngine.ts   MACD + RSI + slope/acceleration           → momentumScore 0-100
volumeEngine.ts     OBV + volume SMA + delta + spike          → volumeScore 0-100
scoringEngine.ts    ContextWeights blend, conflict, confidence, TF alignment
marketContext.ts    assembler: candlesByTf → MarketContext (closed-bar cache)
decisionEngine.ts   VD candidates + MarketContext → Decision[] + Rejection[]
```

### Contracts

```ts
type ContextState = 'bullish' | 'bearish' | 'neutral';

interface ContextWeights { ema: number; supertrend: number; macd: number; rsi: number; adx: number; obv: number; volume: number }
interface TimeframeWeights { '5m': number; '15m': number; '30m': number; '1h': number; '4h': number; '1d': number }
interface ContextConfig {
  weights: ContextWeights;        // default 25/20/15/10/10/10/10
  tfWeights: TimeframeWeights;    // default 5/10/10/20/25/30
  neutralBand: number;            // default 8 → bias neutral within 50±8
  recencyHalfLifeBars: number;    // default 10 (event-score decay)
  htfTfs: Timeframe[];            // default ['4h','1d']
  htfFloor: number;               // default 55 (weighted HTF agreement gate)
}

/** Pluggable scorer (refinement 12): new engines register here, nothing else changes. */
type ContextScoreProducer = (candles: Candle[], tf: Timeframe) => ContextIndicatorScore;

interface ContextIndicatorScore {
  name: string; timeframe: Timeframe; state: ContextState;
  score: number;        // 0-100 directional (50 = neutral)
  confidence: number;   // 0-1 data sufficiency (warm-up, bars available)
  explanation: string;
}

interface TfContext {
  tf: Timeframe; indicators: ContextIndicatorScore[];
  trendScore: number; momentumScore: number; volumeScore: number;
  contextScore: number; bias: ContextState;
  conflictScore: number;  // 0-100 disagreement among indicators (refinement 5)
  confidence: number;     // 0-100 = agreement × data sufficiency (refinement 6)
}

interface MarketContext {
  perTf: Record<Timeframe, TfContext | null>;
  overallBias: ContextState;          // neutral when |score−50| ≤ neutralBand
  contextScore: number;               // TF-weighted alignment 0-100
  trendScore: number; momentumScore: number; volumeScore: number;
  htfAgreement: number;               // weighted 4h/1d score (refinement 3)
  conflictScore: number; confidence: number;
  confirmations: string[]; warnings: string[];
  asOfIndex: number;                  // last CLOSED bar anchor (non-repaint)
}

interface DecisionWeights { context: number; zone: number; trend: number; momentum: number; volume: number; risk: number; liquidity: number }
interface DecisionConfig {
  weights: DecisionWeights;           // default 30/25/15/10/10/5/5
  zoneWeightRange: [number, number];  // default [0.20, 0.45] — dynamic by zone confidence
  minDecisionScore: number;           // default 65 (grade B)
  htfFloor: number;                   // default 55
}

interface Decision {
  signal: VdSignal;
  decisionScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';           // ≥85 / ≥75 / ≥65 / ≥55 / <55
  riskProfile: 'low' | 'medium' | 'high';        // refinement 9
  contextScore: number; htfAgreement: number; conflictScore: number;
  reasons: string[]; warnings: string[];
}
interface Rejection {                              // refinement 10 — WHY NOT
  signal: VdSignal; decisionScore: number;
  failedGates: string[];                           // "1D trend bearish", "context 58 < 65", …
}
```

### Scoring rules

- **Per-indicator scores:** 0–100, 50 = neutral; event scores (MACD cross, Supertrend
  flip) decay toward 50 with `×2^(−age/recencyHalfLifeBars)` on the deviation.
- **Per-TF:** contextScore = ContextWeights blend; conflictScore = 100 × weighted mean
  |score_i − contextScore| / 50; confidence = 100 × (1 − conflict/100) × mean(indicator
  confidence). Sub-engines: trend = EMA 40 / ST 30 / structure 15 / ADX 15;
  momentum = MACD 40 / RSI 30 / slope 20 / accel 10;
  volume = OBV 40 / vol-vs-SMA20 30 / delta 20 / spike 10.
- **Cross-TF:** contextScore = TimeframeWeights blend of per-TF scores;
  htfAgreement = weighted blend over `htfTfs` only; overallBias neutral inside the band.
- **Direction adjustment:** for sells every score s becomes 100 − s before gating.

### Decision Engine

```
zoneW   = clamp(0.20 + 0.25 × zoneConfidence/100, 0.20, 0.45)   // refinement 7
others  = remaining weights renormalized to (1 − zoneW)
riskScore      = 100 − 100×clamp(slDistanceAtr/3, 0, 1) blended with (100−conflict)
liquidityScore = sweep ? 100 : zone.clustered ? 60 : 30
decisionScore  = zoneW×zoneConf + w.context×ctx + w.trend×trend + w.momentum×mom
               + w.volume×vol + w.risk×riskScore + w.liquidity×liquidityScore
```
Gates (each failure recorded as a `Rejection` reason, not silently dropped):
`decisionScore ≥ minDecisionScore` · `htfAgreement ≥ htfFloor` (direction-adjusted) ·
`overallBias` not opposing (neutral allowed). Grade + riskProfile attached to every
accepted Decision.

### Non-repaint + perf (hard requirements, unchanged)

Closed bars per TF (each TF's forming bar dropped); all engine calls cached on
closed-bar signatures; `useMoodEngine` untouched until Task 7 rewires it.

---

## 4. Step-by-step tasks (TDD; commit per task)

1. **`types.ts` + `scoringEngine.ts`** — ALL config interfaces + defaults
   (`DEFAULT_CONTEXT_CONFIG`, `DEFAULT_DECISION_CONFIG`), blend/conflict/confidence
   math, direction adjustment, neutral band. Tests: weight normalization, conflict on
   crafted score sets (agreeing → ~0; split → high), confidence composition, bounds.
2. **`indicatorScores.ts`** — the 7 `ContextScoreProducer`s over existing lib functions
   (closed bars, recency decay, explanations) + the producer registry. Tests per
   producer: bullish/bearish/neutral/warm-up fixtures; decay halves at half-life.
3. **Sub-engines** (`trendEngine` / `momentumEngine` / `volumeEngine`). Tests:
   hand-crafted trending/ranging/diverging fixtures.
4. **`marketContext.ts`** — assembler over candlesByTf: per-TF context, cross-TF +
   htfAgreement, confirmations/warnings, closed-bar cache. Tests: alignment math,
   htfAgreement (1d 55 + 4h 82 → 67 with default weights), neutral band, cache
   identity, forming-bar exclusion.
5. **`decisionEngine.ts`** — dynamic zone weighting, formula, gates, grades, risk
   profile, Decisions + Rejections. Tests: formula arithmetic exact incl. zoneW
   renormalization, grade boundaries, htf gate direction-adjusted, rejection reasons.
6. **Wire into VD signals + UI** — `volumeDistributionZones.ts`: `useContextGate`
   (default ON), `minDecisionScore` input; candidates → `decide()`; labels show
   grade ("BUY · A · 87"); `SignalsPanel` shows decision reasons/warnings AND the
   latest rejections ("No BUY — ❌ 1D trend bearish…"). Golden regen; full suite.
7. **Chart widget + dashboard reuse** — compact `MarketContextWidget` (bias, context,
   confidence, conflict, trend/momentum/volume stars, risk) consuming the SAME
   `MarketContext`; `useMoodEngine` rewired to the engine (one calculation, two
   views; `SignalMatrix` UI unchanged). Live browser verification.

**Deferred (next plan):** backtest by context/grade tier, analytics, weight tuning
from backtests (the config-driven design is what makes that tuning code-free), AI layer.

## 5. Locked decisions (rev. 2)

1. Closed-bar context only. 2. Fixed roster via pluggable registry. 3. Weighted HTF
agreement with floor — **no binary veto**. 4. Everything configuration-driven; the
numbers in this plan are DEFAULTS. 5. Context ≠ confidence; conflict exposed.
6. Decisions graded A+…D with risk profile; rejections always explained.
