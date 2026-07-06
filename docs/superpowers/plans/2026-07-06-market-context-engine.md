# Market Context Engine — MTF Confirmation for Signals (Plan)

> Status: DRAFT — awaiting user review. Source: MTFPlan.md (15 phases / 6 sprints),
> scoped here to Sprints 1–5 + the chart widget; backtest/analytics = Phase 2 plan.

**Goal:** Buy/Sell signals are confirmed by the Multi-Timeframe alignment (the MTF
indicator × {5m,15m,30m,1h,4h,1d} table) via a pure **Market Context Engine**:
`Zones → Market Context → Decision → BUY/SELL`, everything scored 0–100 and explainable.

---

## 1. Assessment — is this the right move? (asked: "what do you think")

**Yes — with three corrections to how the MTF table is used today.** MTF confirmation is
the single highest-value gate available (the research docs estimated +25–35% win rate
for HTF trend alignment alone), and the MTFPlan's architecture is the same Layer-2→3→4
design the VD-zones work was built to feed. But the existing MTF page data **cannot be
used as-is** for signal gating:

1. **It's UI-layer, live-bar data.** `useMoodEngine` is a React hook computing on every
   WebSocket tick over forming bars. A signal gated on live context repaints and can't
   be reproduced in a backtest. → The engine must be a **pure lib** (`lib/context/`,
   zero React — exactly MTFPlan Step 1) evaluating **closed bars only**, and the hook
   later becomes a thin consumer of it (Phase 12, no duplicated calculation).
2. **"Last non-neutral signal" has no recency bound.** `indicatorRows` shows a BUY from
   300 bars ago as BUY forever — fine for a glance table, dangerous as a gate. → Scores
   decay with age (a cross N bars ago scores lower than one 2 bars ago).
3. **The table only covers indicators the user toggled on.** Gate quality must not
   depend on chart toggles. → The context engine uses a **fixed roster** (EMA alignment,
   Supertrend, MACD, RSI, ADX, OBV, Volume — all already implemented in `lib/`),
   independent of `activeIndicatorIds`.

Also honoring MTFPlan's final note: **indicator freeze** — this plan adds no new
indicators, only combines the existing ones.

---

## 2. Architecture (`lib/context/` — pure, no UI/chart/store imports)

```
types.ts            ContextIndicatorScore, TfContext, MarketContext, ContextConfig
indicatorScores.ts  adapters: existing lib indicators → per-TF 0-100 scores (closed bars)
trendEngine.ts      EMA + Supertrend + HH/HL structure + ADX  → trendScore 0-100
momentumEngine.ts   MACD + RSI + slope/acceleration           → momentumScore 0-100
volumeEngine.ts     OBV + volume SMA + delta + spike          → volumeScore 0-100
scoringEngine.ts    weights → per-TF contextScore + cross-TF alignment
marketContext.ts    assembler: candlesByTf → MarketContext (cached per closed bar)
decisionEngine.ts   VD signal candidates + MarketContext → final scored decisions
```

### Contracts (MTFPlan Steps 2–3; renamed to avoid the framework's `IndicatorResult`)

```ts
type ContextState = 'bullish' | 'bearish' | 'neutral';

interface ContextIndicatorScore {
  name: string;            // 'emaAlign' | 'supertrend' | 'macd' | 'rsi' | 'adx' | 'obv' | 'volume'
  timeframe: Timeframe;
  state: ContextState;
  score: number;           // 0-100 directional strength (50 = neutral)
  confidence: number;      // 0-1 data sufficiency (warm-up, bars available)
  explanation: string;     // "EMA9 > EMA21 by 0.8×ATR, widening"
}

interface TfContext {
  tf: Timeframe;
  indicators: ContextIndicatorScore[];
  trendScore: number; momentumScore: number; volumeScore: number;
  contextScore: number;    // weighted blend, 0-100 (>50 bullish, <50 bearish)
  bias: ContextState;
}

interface MarketContext {
  perTf: Record<Timeframe, TfContext | null>;
  overallBias: ContextState;
  contextScore: number;    // TF-weighted cross-TF alignment, 0-100
  trendScore: number; momentumScore: number; volumeScore: number;
  confirmations: string[]; // "4h EMA bullish", "1d Supertrend bullish", …
  warnings: string[];      // "15m RSI 78 (overbought)", "1h volume fading", …
  asOfIndex: number;       // last CLOSED bar of the evaluation TF (non-repaint anchor)
}
```

### Scoring (MTFPlan Phases 3–6; all weights configurable)

- **Indicator weights (per TF):** EMA 25 · Supertrend 20 · MACD 15 · RSI 10 · ADX 10 ·
  OBV 10 · Volume 10. Each maps to 0–100 where 50 = neutral; **recency decay** —
  event-type scores (MACD cross, Supertrend flip) decay toward 50 with bar age
  (`×e^(−age/10)` on the deviation from 50).
- **TF weights (cross-TF alignment):** 5m 5 · 15m 10 · 30m 10 · 1h 20 · 4h 25 · 1d 30 —
  higher timeframes dominate confirmation (that's the point of MTF).
- **Sub-engines:** trend = EMA(40%) + Supertrend(30%) + structure HH/HL(15%) + ADX(15%);
  momentum = MACD(40%) + RSI(30%) + close-slope(20%) + acceleration(10%);
  volume = OBV slope(40%) + vol vs SMA20(30%) + buy/sell delta(20%) + spike(10%).
- **Explanations (Phase 7):** every score carries its reasons; `confirmations[]` /
  `warnings[]` roll up the strongest agreeing/opposing facts.

### Decision Engine (MTFPlan Phases 8–9)

`decide(candidates: VdSignal[], ctx: MarketContext, cfg) → Decision[]`

```
decisionScore = 0.35 × zoneQuality      (VdZone confidence, bar-time)
             + 0.35 × contextScore     (direction-adjusted: sell uses 100 − score)
             + 0.15 × reactionScore    (zone bounce history)
             + 0.10 × rrScore          (clamp(RR/3) × 100)
             + 0.05 × sweepBonus       (100 if liquidity sweep, else 0)
```
Gates: `decisionScore ≥ 65` (configurable) AND direction agreement
(`buy` needs `overallBias !== 'bearish'` AND 4h+1d contextScore ≥ 50; mirrored for sell).
Output `Decision` = VdSignal + decisionScore + contextScore + `reasons[]`/`warnings[]`
(Phase 10 explainability, same grammar as the SignalsPanel).

### Non-repaint + perf (hard requirements)

- Context evaluates **closed bars per TF** (drop each TF's forming bar). Signals gate on
  the context as of the signal bar's close → reproducible, backtestable.
- All engine calls cached on closed-bar signatures (the `sd_signals` hang lesson);
  `useMoodEngine` keeps working as today until Task 7 rewires it to consume this engine.

---

## 3. Step-by-step tasks (TDD; commit per task)

1. **`types.ts` + `scoringEngine.ts` skeleton** — contracts, weights, TF weights,
   blend math. Tests: weight normalization, blend bounds, direction adjustment.
2. **`indicatorScores.ts`** — the 7 adapters over existing lib functions (closed bars,
   recency decay, explanations). Tests per adapter on crafted candles (bullish/bearish/
   neutral/warm-up cases).
3. **`trendEngine.ts` + `momentumEngine.ts` + `volumeEngine.ts`** — sub-scores with
   structure/slope/delta components. Tests: hand-crafted trending/ranging fixtures.
4. **`marketContext.ts`** — assembler over `candlesByTf`, per-TF context + cross-TF
   alignment + confirmations/warnings + closed-bar cache. Tests: alignment math
   (all-bullish → >80; split → ~50), cache identity, forming-bar exclusion.
5. **`decisionEngine.ts`** — formula + gates + explanation merge. Tests: formula
   arithmetic exact, direction gates, threshold behavior.
6. **Wire into VD signals** — `volumeDistributionZones.ts` gains `useContextGate`
   (default ON) + `minDecisionScore` inputs; candidates from `generateVdSignals` pass
   through `decide()`; arrows/levels/labels show the decision score. `SignalsPanel`
   explanation gains the context reasons/warnings. Golden fixture regen. Full suite.
7. **Chart widget + dashboard reuse (Phases 11–12)** — compact `MarketContextWidget`
   (top-right: bias, context score, trend/momentum/volume stars, risk from warnings
   count) reading the SAME `MarketContext`; click → opens the MTF rail panel.
   `useMoodEngine` rewired to consume `marketContext.ts` (no duplicate calc, existing
   `SignalMatrix` UI unchanged). Live browser verification.

**Deferred (next plan):** MTFPlan Phases 13–14 (backtest by context tier, analytics)
and 15 (AI layer) — the structured `MarketContext`/`Decision` outputs already make
them possible without engine changes.

---

## 4. Decisions locked in this plan (veto at review)

1. Closed-bar context only (non-repaint > immediacy).
2. Fixed 7-indicator roster, independent of chart toggles.
3. TF weights favor 4h/1d; both must not oppose the trade direction.
4. Decision formula + 65 threshold as MTFPlan defaults, all configurable.
5. Scope = MTFPlan Sprints 1–5 + widget; backtest/analytics deferred.
