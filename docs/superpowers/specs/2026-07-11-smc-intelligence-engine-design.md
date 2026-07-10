# SMC Intelligence Engine — Design

**Date:** 2026-07-11
**Status:** Approved pending user review
**Sources of truth:**
- `~/Downloads/SDD.md` — LuxAlgo Smart Money Concepts Pine v5 script (frozen reference spec; clean indentation). `smartmoney.md` is a markdown-mangled duplicate — do not use.
- `~/Downloads/additionalInfo.md` — architecture directive: build an *engine*, not an indicator.
- `~/Downloads/smartupdate.md` — advisor review; its 8 refinements are incorporated below.

## 1. Goal

A headless, deterministic **SMC Intelligence Engine** in `lib/smc/` that, for any candle series, produces scored, ID'd, lifecycle-tracked SMC objects (structure, liquidity, order blocks, FVGs, premium/discount zones), a confluence assessment, and an institutional score — as pure data. A thin chart-overlay adapter renders it. The scanner, alerts, AI, and backtester consume the same snapshot later without reimplementing market logic.

**Non-goals (v1):** D/W/M levels, sessions (Asia/London/NY), trend candle coloring, MTF FVG (`request.security`), AI reasoning, signal automation. Extension points are left for them (§10).

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Deliverable | Engine + chart overlay (no scanner wiring in v1) |
| Detection fidelity | LuxAlgo-faithful core, verified by golden-master; intelligence layer additive on top |
| Execution model | Pure batch `computeSmc(candles, config)`; internally one sequential bar-by-bar pass (Pine `var` semantics); cached by caller on closed-bar signature |
| Feature cut | Market structure (swing 50 + internal 5, BOS/CHoCH), liquidity (EQH/EQL + sweeps), order blocks (internal + swing), FVG (same-TF), premium/discount zones, confluence, institutional score |

## 3. Module layout

```
lib/smc/
  types.ts               ids, enums, config, object/event/snapshot contracts
  volatility.ts          ATR(200), cumulative mean range, high-volatility-bar parsing
  swings.ts              leg(size), pivot detection            [faithful port]
  marketStructure.ts     BOS/CHoCH (swing + internal), trend bias, HH/HL/LH/LL,
                         trailing extremes, strong/weak H/L    [faithful port]
  liquidity.ts           EQH/EQL [faithful] + sweep detection  [intelligence]
  orderBlocks.ts         OB creation + mitigation [faithful] + lifecycle [intelligence]
  fvg.ts                 FVG detection [faithful, same-TF] + fill tracking [intelligence]
  premiumDiscount.ts     premium/equilibrium/discount zones + price position
  scoring.ts             strength / quality / confidence formulas (0–100)
  confluence.ts          cross-module agreement factors
  institutionalScore.ts  weighted composite + setup state machine
  engine.ts              computeSmc() — assembles the snapshot in one pass
lib/indicators/smcOverlay.ts   indicator-framework adapter (render only)
```

`swings.ts` is deliberately independent of `marketStructure.ts` (swings are reusable by other engines; market structure depends on swings).

## 4. Data contracts

### 4.1 Objects

Every detected object:

```ts
interface SmcObject {
  id: string;                    // e.g. "ob_<barIndex>_<direction>", deterministic (same input ⇒ same id)
  kind: 'orderBlock' | 'fvg' | 'liquidityPool' | 'structureLevel' | 'zone';
  scope: 'swing' | 'internal';   // where applicable
  direction: 'bullish' | 'bearish';
  top: number; bottom: number;   // price band (level objects: top === bottom)
  createdAtBar: number; createdAtTime: number;
  updatedAtBar: number;
  state: SmcLifecycle;
  touches: number;               // times price traded into the band without mitigation
  strength: number;              // 0–100, intrinsic at creation (impulse size vs ATR)
  quality: number;               // 0–100, current: age decay, untested-ness, fill %
  confidence: number;            // 0–100, contextual: confluence agreement
}
```

### 4.2 Lifecycle — one enum, every object kind

```ts
type SmcLifecycle = 'active' | 'tested' | 'partial' | 'mitigated' | 'invalidated' | 'archived';
```

Kind-specific meaning:
- **Order block:** active → tested (wick into band) → partial (close inside) → mitigated (LuxAlgo mitigation rule crossed) → archived (older than `maxAgeBars`).
- **FVG:** active → partial (gap partially traded) → mitigated (= filled, LuxAlgo delete rule) → archived.
- **Liquidity pool (EQH/EQL):** active → mitigated (= swept) → archived.
- **Structure level (last swing/internal pivot):** active → mitigated (= broken, produced the BOS/CHoCH) → archived.
- `invalidated` is reserved for objects contradicted without a clean mitigation (e.g. OB fully engulfed by opposing displacement).

### 4.3 Events (append-only log, replayable)

```ts
interface SmcEvent {
  id: string;
  type: 'BOS' | 'CHOCH' | 'SWING_FORMED' | 'OB_CREATED' | 'OB_TESTED' | 'OB_MITIGATED'
      | 'FVG_CREATED' | 'FVG_FILLED' | 'EQH_FORMED' | 'EQL_FORMED' | 'LIQUIDITY_SWEEP'
      | 'ZONE_CHANGED';
  barIndex: number; time: number;
  direction: 'bullish' | 'bearish';
  scope?: 'swing' | 'internal';
  objectId?: string;             // links event → object
  price: number;
}
```

### 4.4 Snapshot

```ts
interface SmcSnapshot {
  metadata:    { version: string; symbol?: string; tf?: string; config: SmcConfig };
  state:       { swingTrend: Bias; internalTrend: Bias; zone: 'premium'|'equilibrium'|'discount';
                 trailing: { top: number; bottom: number; lastTopTime: number; lastBottomTime: number };
                 setup: SetupState; setupDirection: Bias | null };
  objects:     { orderBlocks: SmcObject[]; fvgs: SmcObject[]; liquidityPools: SmcObject[];
                 structureLevels: SmcObject[]; zones: SmcObject[] };
  events:      SmcEvent[];
  scores:      { structure: number; liquidity: number; orderBlocks: number; fvg: number;
                 premiumDiscount: number; confluence: number; institutional: number };
  diagnostics: { barsProcessed: number; computeMs: number; version: string; warnings: string[] };
}
```

### 4.5 Config (with algorithm versioning)

```ts
interface SmcConfig {
  version: '1.0';                       // algorithm version; bump to evolve detection without breaking old backtests
  // LuxAlgo-parity inputs (defaults = script defaults)
  swingsLength: 50; internalLength: 5;
  eqLength: 3; eqThreshold: 0.1;
  obFilter: 'atr' | 'range'; obMitigation: 'highlow' | 'close';
  maxInternalOrderBlocks: 5; maxSwingOrderBlocks: 5;
  fvgAutoThreshold: true; fvgExtend: 1;
  // Intelligence layer
  weights: InstitutionalWeights;        // structure/liquidity/orderBlocks/fvg/premiumDiscount — no hardcoded weights
  maxAgeBars: number;                   // archive horizon
  sweepConfirmBars: number;             // bars for close-back-inside confirmation
}
```

Default weights (tunable config, not code): structure 30, orderBlocks 25, liquidity 25, fvg 10, premiumDiscount 10.

## 5. Detection core (LuxAlgo-faithful)

Direct ports of the Pine reference, same semantics per bar:
- **Volatility parsing:** `highVolatilityBar = (high − low) ≥ 2 × measure`; parsed highs/lows swap on such bars. Measure = ATR(200) or cumulative mean range per config.
- **Swings:** `leg(size)` using `high[size] > highest(size)` / `low[size] < lowest(size)`; pivots on leg change. Sizes: `swingsLength` (50), 5 (internal), `eqLength` (3, equal H/L).
- **Structure:** close crossover/crossunder of uncrossed pivot level ⇒ BOS (with trend) or CHoCH (against trend); updates trend bias; internal breaks require internal level ≠ swing level (confluence filter off by default, as in script).
- **Order blocks:** on each structure break, scan parsed highs/lows over `[pivot.barIndex, barIndex]` for the extreme bar; store as OB; mitigation when high/low (or close) crosses the band edge per config.
- **EQH/EQL:** new pivot within `eqThreshold × ATR(200)` of previous pivot level.
- **FVG:** 3-bar gap (`low > high[2]` bullish / `high < low[2]` bearish) with close confirmation and auto delta threshold; deleted (⇒ `mitigated`) when price trades through the far edge.
- **Premium/discount:** trailing swing extremes; premium = top 5%…, equilibrium band ±2.5% around midpoint, discount = bottom 5% (script's 0.95/0.525 factors).

**Sweep detection (intelligence, not in script):** price wicks beyond an active EQH/EQL pool or trailing extreme and closes back inside within `sweepConfirmBars` ⇒ `LIQUIDITY_SWEEP` event, pool `mitigated`, directional score boost against the sweep direction.

## 6. Scoring — strength / quality / confidence (three distinct metrics)

Per object:
- **strength** — intrinsic, frozen at creation. OB: displacement leaving the block (× ATR) . FVG: gap size vs ATR. Pool: number of equal touches. Structure: break magnitude vs ATR.
- **quality** — current condition. Decays with age; drops with touches/partial fill; untested = 100 baseline.
- **confidence** — context. Alignment with swing+internal trend, zone position (bullish OB in discount > in premium), proximity of supporting objects.

Module scores (0–100) aggregate their live objects; `confluence.ts` computes agreement factors; `institutionalScore.ts` blends module scores via `weights` and signs by direction agreement.

**Setup state machine** (replaces WAIT/WATCH/SETUP):

```
none → watch → building → ready → confirmed → exhausted
                    ↘ invalidated (from any pre-confirmed state)
```

Transition heuristics (v1, tunable thresholds in config): `watch` = institutional ≥ 50 with direction agreement; `building` = ≥ 65 + price approaching a qualifying object; `ready` = ≥ 75 + inside qualifying zone/object; `confirmed` = ready + trigger event (CHoCH/BOS/sweep in direction); `exhausted` = confirmed + target structure reached or score decay; `invalidated` = qualifying object mitigated against direction.

## 7. Engine assembly & performance

`computeSmc()` runs one sequential pass, O(n), allocating per-pass state (no module-level mutable state). The overlay/indicator adapter caches the snapshot keyed on `(symbol, tf, closedBarCount, lastClosedBarTime, configHash)` per the indicator-tick-perf rule — live in-bar ticks reuse the cached snapshot. `diagnostics.computeMs` records the pass cost; warn if > 50 ms for 5k bars.

## 8. Chart overlay (render-only adapter)

`lib/indicators/smcOverlay.ts` registered in `CUSTOM_INDICATORS`:
- Structure lines + BOS/CHoCH labels (swing solid, internal dashed), EQH/EQL dotted lines, OB boxes, FVG boxes, premium/discount/equilibrium shading — LuxAlgo default colors mapped to theme tokens; per-feature visibility toggles in indicator settings.
- **Display modes:** `normal` (active objects within display limits — script behavior) and `debug` (everything incl. archived/mitigated objects with state badges and scores) — a settings toggle for development verification.
- The adapter never computes; it maps snapshot → existing plot/band/zone/marker primitives.

## 9. Testing

1. **Golden-master** — `lib/smc/engine.golden.test.ts` following the existing `lib/indicators/*.golden.test.ts` harness convention: BTCUSDT fixture; assert BOS/CHoCH event sequence, OB bands, EQH/EQL, FVGs against TradingView-captured expected output of the reference script.
2. **Unit tests** — per intelligence module (sweeps, lifecycle transitions, scoring, setup machine) on small synthetic fixtures with hand-checkable answers.
3. **Regression tests** — `lib/smc/__fixtures__/regressions/`: every detection bug fixed adds its candle fixture + expected output; the suite replays all of them. Never let a bug return.

## 10. Future-proofing (hooks only, no implementation)

- `SmcModuleResult` is the uniform shape every module returns; future engines (volume, sessions, volume profile, VWAP, delta, AI reasoning) plug into `confluence.ts` + `weights` by adding a key — no engine.ts rewrite.
- `events` log is the integration surface for alerts/backtester/AI (consume by `objectId`).
- `metadata.version` gates algorithm evolution.

## 11. Milestones

1. `types.ts` + `volatility.ts` + `swings.ts` (+ unit tests)
2. `marketStructure.ts` + `orderBlocks.ts` + golden-master vs TradingView
3. `liquidity.ts` + `fvg.ts` + `premiumDiscount.ts` (+ golden additions, sweep unit tests)
4. `scoring.ts` + `confluence.ts` + `institutionalScore.ts` (+ unit tests)
5. `engine.ts` snapshot assembly + diagnostics
6. `smcOverlay.ts` + settings + debug mode; visual side-by-side vs TradingView
