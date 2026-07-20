# M9 Trade Decision Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (subagents are banned in this repo — token budget). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lib/mtf/decision/` — the first actionable layer: gates M8's conclusion through a 7-rung no-trade ladder, prices entry/stop/targets from ATR + swing structure on the execution TF, optionally refines via bounded SMC confluence, and assigns an account-agnostic risk tier.

**Architecture:** Gated pipeline of small pure modules (M4/M8 house style). Consumes `FullMarketIntelligence` + candles (+ optional `SmcSnapshot`); never recomputes M0–M8. Spec: `docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md` (read it first — it is the authority; this plan operationalizes it).

**Tech Stack:** TypeScript, Vitest, `pm.tr`/`pm.rma` from `lib/pineMath` for ATR.

## Global Constraints (house rules, every task)

- **Releasable per task:** tsc clean + full suite green + one atomic commit; graphify updates via post-commit hook automatically.
- tsc gate: `npx tsc --noEmit 2>&1 | grep -v "DataTable.tsx"` — the ONLY acceptable residue is the 4 continuation lines of the 2 pre-existing `components/ui/DataTable.tsx` errors (`'className' does not exist…`). Anything else = your bug.
- Suite gate: `npx vitest run` — all green (1219 pre-existing + new).
- Strict TDD: failing test first, watch it fail, minimal implementation, watch it pass.
- **Exact hand-computed expected values** in tests — never compute expectations by calling the code under test.
- Import gotcha: from `lib/mtf/decision/`, `Candle`/`Timeframe` come from `'../../types'`; `Verdict` from `'../types'`; pineMath from `'../../pineMath'`; SMC types from `'../../smc/types'`.
- Banned predictive vocabulary in ALL user-facing text: `/\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i`.
- Deterministic: no `Date.now()`, no timestamps, closed bars only.
- M0–M8 files are FROZEN — this milestone creates `lib/mtf/decision/` and touches nothing else outside `docs/`.
- Config constants exported with JSDoc `"Conservative default; tuned later; API stable."` — no magic numbers in logic.

## Shared test fixture math (used across Tasks 2, 3, 6, 7 — derive once, reuse)

Candle helper (verify `Candle` field names in `lib/types.ts` at implementation; expected `{ time, open, high, low, close, volume }`):

```typescript
const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m,
  high: m + 1, low: m - 1, close: m, volume: 100,
}));
```

Every bar has range `high − low = 2` and |Δmid| ≤ 1, so True Range = 2 on every bar and RMA(TR) = **ATR = 2 exactly** — all levels hand-computable.

**LONG fixture** `mids = [100,101,102,103,104,105,106,107,108,109,110,109,108,107,106,107,107,107,107,107]` (20 bars):
swing high (k=2) = bar 10 high **111**; swing low = bar 14 low **105**; last close 107.
Zone `[105, 105.5]`, entryMid 105.25, type `pullback`; stop `103`; risk 2.25; distancePct **2.14**; target1 = 111, rr **2.56**; target2 = 109.75, rr 2.0.

**MARKET-entry variant** `mids = [100,101,102,103,104,105,106,107,108,109,110,109,108,107,106,107,107,106.5,106,105.4]`: same swings/levels, last close 105.4 ∈ [105, 105.5] → type `market`.

**SHORT fixture** `mids = [120,119,118,117,116,115,114,113,112,111,110,111,112,113,114,113,113,113,113,113]`:
swing low = bar 10 low **109**; swing high = bar 14 high **115**; close 113.
Zone `[114.5, 115]`, entryMid 114.75, `pullback`; stop `117`; distancePct **1.96**; target1 = 109, rr **2.56**; target2 = 110.25, rr 2.0.

**INSUFFICIENT fixture** `mids = [100,101,…,119]` (monotone): no confirmed swing low → long blocks `insufficient_structure`.

**RR-TOO-LOW fixture** `mids = [100,101,102,101,100,99,100,101,100.5,100,100.5,101,101,101,101,101,101,101,101,101]`:
last swing high = bar 7 high **102**; last swing low = bar 9 low **99**; close 101.
Zone `[99, 99.5]`, entryMid 99.25; stop 97; risk 2.25; structural target 102 → rr = 2.75/2.25 = **1.22** < 1.5 → `rr_too_low`, `rawRR: 1.22`.

**NO-OBSTACLE fixture** `mids = [104,103,102,101,100,101,102,103,…,115]` (V, +1/bar after bar 4, 20 bars):
swing low = bar 4 low **99**; **no confirmed swing high** → targets = `[measured 103.75, rr 2.0]` (single), rr = 2.0; distancePct **2.27**.

---

### Task 1: Contract + config

**Files:**
- Create: `lib/mtf/decision/decisionTypes.ts`, `lib/mtf/decision/config.ts`
- Test: `lib/mtf/decision/config.test.ts`

**Interfaces — Produces (everything later tasks import):** all types from the spec's Contract section verbatim (`TradeAction`, `RiskTier`, `EntryType`, `LevelSource`, `TradeSide`, `PriceLevel`, `ConfluenceNote`, `DecisionSignal`, `TradeSetup`, `TradeDecisionResult`, `GateResult`), plus `DECISION_CONFIG`, `PRIOR_TIER_CAP`.

- [ ] **Step 1: Failing test**

```typescript
// lib/mtf/decision/config.test.ts
import { describe, expect, it } from 'vitest';
import { DECISION_CONFIG, PRIOR_TIER_CAP } from './config';

describe('M9 decision config', () => {
  it('freezes the v1 defaults exactly', () => {
    expect(DECISION_CONFIG).toEqual({
      atrLength: 14, swingConfirmBars: 2, entryZoneAtrMult: 0.25, stopAtrMult: 1.0,
      targetRR: 2.0, minRR: 1.5, smcSnapToleranceAtrMult: 0.5,
      stopExtendMaxAtrMult: 0.75, stopBufferAtrMult: 0.1, minCandles: 20,
    });
    expect(PRIOR_TIER_CAP).toBe('half');
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/mtf/decision/config.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement.** `decisionTypes.ts` = the spec Contract block verbatim, plus:

```typescript
export type TradeSide = 'long' | 'short';
export interface GateResult { passed: boolean; blockedBy: string | null; reason: string }
```

(`TradeDecisionResult.gate` uses `GateResult`. `Verdict` from `'../types'`, `Timeframe` from `'../../types'`.)

`config.ts`:

```typescript
import type { RiskTier } from './decisionTypes';

/** Conservative defaults; tuned later; API stable. */
export const DECISION_CONFIG = {
  atrLength: 14,
  swingConfirmBars: 2,       // k bars each side to confirm a fractal swing
  entryZoneAtrMult: 0.25,
  stopAtrMult: 1.0,
  targetRR: 2.0,             // measured-move target
  minRR: 1.5,                // gate rung 7
  smcSnapToleranceAtrMult: 0.5,
  stopExtendMaxAtrMult: 0.75,
  stopBufferAtrMult: 0.1,
  minCandles: 20,            // rung 5 floor (covers atrLength + swing confirmation)
};

/** While M7 runs on model priors, no environment justifies full risk. */
export const PRIOR_TIER_CAP: RiskTier = 'half';
```

- [ ] **Step 4:** test passes. **Step 5:** tsc gate + full suite. **Step 6:** commit `feat(mtf): M9 contract + config (decisionTypes, DECISION_CONFIG)`.

---

### Task 2: Swing detection

**Files:** Create `lib/mtf/decision/swings.ts`; Test `lib/mtf/decision/swings.test.ts`

**Interfaces — Produces:**
```typescript
export interface SwingPoint { index: number; price: number }
export function findSwings(candles: Candle[], k?: number): { highs: SwingPoint[]; lows: SwingPoint[] }
export function lastConfirmedSwings(candles: Candle[], k?: number): { swingHigh: SwingPoint | null; swingLow: SwingPoint | null }
```

- [ ] **Step 1: Failing tests** — using the shared `bars` helper and LONG / INSUFFICIENT / RR-TOO-LOW fixtures:

```typescript
import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { findSwings, lastConfirmedSwings } from './swings';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));

const LONG = [100,101,102,103,104,105,106,107,108,109,110,109,108,107,106,107,107,107,107,107];
const RRLOW = [100,101,102,101,100,99,100,101,100.5,100,100.5,101,101,101,101,101,101,101,101,101];

describe('fractal swings (k=2, strict, confirmed only)', () => {
  it('finds the single swing high/low pair in the canonical long fixture', () => {
    const { swingHigh, swingLow } = lastConfirmedSwings(bars(LONG));
    expect(swingHigh).toEqual({ index: 10, price: 111 });
    expect(swingLow).toEqual({ index: 14, price: 105 });
  });
  it('returns the MOST RECENT confirmed swings when several exist', () => {
    const { highs, lows } = findSwings(bars(RRLOW));
    expect(highs.map((s) => s.price)).toEqual([103, 102]);   // bars 2, 7
    expect(lows.map((s) => s.price)).toEqual([98, 99]);      // bars 5, 9
    const last = lastConfirmedSwings(bars(RRLOW));
    expect(last.swingHigh).toEqual({ index: 7, price: 102 });
    expect(last.swingLow).toEqual({ index: 9, price: 99 });
  });
  it('monotone series has no confirmed swings; last k bars never confirm', () => {
    const mono = bars(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(lastConfirmedSwings(mono)).toEqual({ swingHigh: null, swingLow: null });
  });
  it('ties are not swings (strict comparison)', () => {
    // flat plateau: equal highs never confirm
    const flat = bars([100,100,100,100,100,100,100,100]);
    expect(lastConfirmedSwings(flat)).toEqual({ swingHigh: null, swingLow: null });
  });
});
```

- [ ] **Step 2:** run — FAIL. **Step 3: Implement:**

```typescript
import type { Candle } from '../../types';
import { DECISION_CONFIG } from './config';

export interface SwingPoint { index: number; price: number }

/** Fractal swings: bar i is a swing high iff high[i] is STRICTLY greater than the
 *  highs of the k bars on each side (mirror for lows). Only confirmed swings count —
 *  the final k bars cannot confirm. */
export function findSwings(candles: Candle[], k = DECISION_CONFIG.swingConfirmBars) {
  const highs: SwingPoint[] = []; const lows: SwingPoint[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true; let isLow = true;
    for (let j = 1; j <= k; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

export function lastConfirmedSwings(candles: Candle[], k = DECISION_CONFIG.swingConfirmBars) {
  const { highs, lows } = findSwings(candles, k);
  return { swingHigh: highs.at(-1) ?? null, swingLow: lows.at(-1) ?? null };
}
```

- [ ] **Step 4:** pass. **Step 5:** gates. **Step 6:** commit `feat(mtf): M9 fractal swing detection`.

---

### Task 3: Levels core (ATR + entry/stop/targets/RR)

**Files:** Create `lib/mtf/decision/levels.ts`; Test `lib/mtf/decision/levels.test.ts`

**Interfaces — Produces:**
```typescript
export function lastAtr(candles: Candle[], length?: number): number | null
export function assembleSetup(args: {
  side: TradeSide; zone: [number, number]; entryBasis: PriceLevel; stop: PriceLevel;
  structuralTarget: PriceLevel | null; atr: number; lastClose: number;
}): TradeSetup
export type LevelsOutcome =
  | { kind: 'setup'; setup: TradeSetup; lastClose: number; swingHigh: number | null; swingLow: number | null }
  | { kind: 'block'; block: 'insufficient_structure' | 'rr_too_low'; rawRR: number | null;
      swingHigh: number | null; swingLow: number | null };
export function buildSetup(side: TradeSide, candles: Candle[]): LevelsOutcome
```
`assembleSetup` is the single place all derived numbers are computed (entry type from lastClose, distancePct, targets array, rr) — Task 6's refiner reuses it so core and refined setups can never drift.

- [ ] **Step 1: Failing tests** — all six shared fixtures, exact values:

```typescript
// key assertions (full file mirrors the shared-fixture section):
const out = buildSetup('long', bars(LONG));
// kind 'setup'; setup:
//   entry.zone [105, 105.5], entry.type 'pullback', entry.basis.source 'swing'
//   stop { price: 103, source: 'swing', distancePct: 2.14 }  (description mentions ATR)
//   targets [ { price: 111, source: 'swing', rr: 2.56 }, { price: 109.75, source: 'atr', rr: 2 } ]
//   rr 2.56, atr 2
// MARKET variant → entry.type 'market'
// SHORT fixture → zone [114.5, 115], stop 117 (distancePct 1.96), targets [109 rr 2.56, 110.25 rr 2],
//   entry.type 'pullback'
// INSUFFICIENT → { kind:'block', block:'insufficient_structure', rawRR: null }
// RR-TOO-LOW → { kind:'block', block:'rr_too_low', rawRR: 1.22, swingHigh: 102, swingLow: 99 }
// NO-OBSTACLE → single target [ { price: 103.75, source:'atr', rr: 2 } ], rr 2, distancePct 2.27
// lastAtr(bars(LONG)) === 2 exactly
// broken structure: close at/below stop → insufficient_structure:
//   take LONG fixture and append nothing — instead craft mids ending 102.9 is NOT possible with |Δmid|≤1,
//   so test assembleSetup guard directly via buildSetup on mids that dive: use
//   [100,...,110,109,...,106,105,104,103,102] style series where the last close ≤ swingLow − 2·1
//   — verify block 'insufficient_structure'.
```

Write these as real `expect(...).toEqual(...)` assertions (no comments-as-tests).

- [ ] **Step 2:** FAIL. **Step 3: Implement:**

```typescript
import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import { DECISION_CONFIG } from './config';
import type { PriceLevel, TradeSetup, TradeSide } from './decisionTypes';
import { lastConfirmedSwings } from './swings';

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Last RMA(TR) value — same TradingView-faithful math as lib/indicators/atr.ts, no plot wrapper. */
export function lastAtr(candles: Candle[], length = DECISION_CONFIG.atrLength): number | null {
  const atr = pm.rma(pm.tr(candles), length).at(-1);
  return typeof atr === 'number' && Number.isFinite(atr) && atr > 0 ? atr : null;
}

export function assembleSetup(args: { /* as in Interfaces */ }): TradeSetup {
  const { side, zone, entryBasis, stop, structuralTarget, atr, lastClose } = args;
  const entryMid = (zone[0] + zone[1]) / 2;
  const risk = side === 'long' ? entryMid - stop.price : stop.price - entryMid;
  const type = lastClose >= zone[0] && lastClose <= zone[1] ? 'market' : 'pullback';
  const measured = r2(side === 'long' ? entryMid + DECISION_CONFIG.targetRR * risk
                                      : entryMid - DECISION_CONFIG.targetRR * risk);
  const measuredLevel = { price: measured, source: 'atr' as const, rr: DECISION_CONFIG.targetRR,
    description: structuralTarget ? 'Measured move at 2R' : 'No structural obstacle; measured move at 2R' };
  const targets = structuralTarget
    ? [{ ...structuralTarget,
         rr: r2((side === 'long' ? structuralTarget.price - entryMid : entryMid - structuralTarget.price) / risk) },
       measuredLevel]
    : [measuredLevel];
  return {
    entry: { zone, type, basis: entryBasis },
    stop: { ...stop, distancePct: r2((risk / entryMid) * 100) },
    targets, rr: targets[0].rr, atr,
  };
}

export function buildSetup(side: TradeSide, candles: Candle[]): LevelsOutcome {
  const atr = lastAtr(candles);
  const { swingHigh, swingLow } = lastConfirmedSwings(candles);
  const sh = swingHigh?.price ?? null; const sl = swingLow?.price ?? null;
  const anchor = side === 'long' ? swingLow : swingHigh;
  if (!anchor || atr === null) return { kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: sh, swingLow: sl };
  const lastClose = candles[candles.length - 1].close;
  const stopPrice = r2(side === 'long' ? anchor.price - DECISION_CONFIG.stopAtrMult * atr
                                       : anchor.price + DECISION_CONFIG.stopAtrMult * atr);
  if (side === 'long' ? lastClose <= stopPrice : lastClose >= stopPrice)
    return { kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: sh, swingLow: sl };
  const zone: [number, number] = side === 'long'
    ? [anchor.price, r2(anchor.price + DECISION_CONFIG.entryZoneAtrMult * atr)]
    : [r2(anchor.price - DECISION_CONFIG.entryZoneAtrMult * atr), anchor.price];
  const opposing = side === 'long' ? swingHigh : swingLow;
  const beyondZone = opposing && (side === 'long' ? opposing.price > zone[1] : opposing.price < zone[0]);
  const structuralTarget: PriceLevel | null = beyondZone
    ? { price: opposing.price, source: 'swing', description: `Most recent confirmed swing ${side === 'long' ? 'high' : 'low'}` }
    : null;
  const setup = assembleSetup({
    side, zone,
    entryBasis: { price: anchor.price, source: 'swing', description: `Confirmed swing ${side === 'long' ? 'low' : 'high'} anchor` },
    stop: { price: stopPrice, source: 'swing', description: `Beyond swing ${side === 'long' ? 'low' : 'high'} by ${DECISION_CONFIG.stopAtrMult} ATR` },
    structuralTarget, atr, lastClose,
  });
  if (setup.rr < DECISION_CONFIG.minRR)
    return { kind: 'block', block: 'rr_too_low', rawRR: setup.rr, swingHigh: sh, swingLow: sl };
  return { kind: 'setup', setup, lastClose, swingHigh: sh, swingLow: sl };
}
```

- [ ] **Step 4:** pass. **Step 5:** gates. **Step 6:** commit `feat(mtf): M9 levels core — ATR + swing entry/stop/targets/RR`.

---

### Task 4: Environment gate + shared decision test fixtures

**Files:** Create `lib/mtf/decision/gate.ts`, `lib/mtf/decision/testFixtures.ts` (TEST-ONLY, like M8's); Test `lib/mtf/decision/gate.test.ts`

**Interfaces — Produces:**
```typescript
// gate.ts
export function environmentGate(market: MarketIntelligenceResult): GateResult
// testFixtures.ts (imported only by *.test.ts)
export function mkMarket(patch?: {...section partials...}): MarketIntelligenceResult
export function mkFullIntel(market?: MarketIntelligenceResult, hierarchy?: HierarchyResult): FullMarketIntelligence
```

- [ ] **Step 1:** `testFixtures.ts` — base via `computeMarketIntelligence(agr(), conf(), hier(), lcyc(), prob())` (M8's factories), explicit section-wise shallow merges for `readiness`, `headline`, `risk`, `quality`, `outlook` (+ nested `outlook.invalidation`). `mkFullIntel` wraps into `{ result, layers: { snapshots: [], hierarchy, lifecycle: lcyc(), agreement: agr(), confidence: conf(), probability: prob() } }`.
- [ ] **Step 2: Failing tests** — one per rung, first-match order proven:

```typescript
// readiness wait → { passed:false, blockedBy:'environment_wait', reason: <M8 reason verbatim> }
// readiness ready + bias neutral → 'no_directional_edge'
// ready + bullish + risk extreme → 'extreme_risk'
// ready + bullish + risk low + outlook.invalidation.invalidated → 'lifecycle_invalidated'
// ready + bullish + risk low + not invalidated → { passed:true, blockedBy:null }
// ordering: wait AND neutral → environment_wait wins (rung 1 before rung 2)
```

- [ ] **Step 3: Implement** `environmentGate` as a first-match ladder returning stable codes
  `environment_wait|environment_no_trade|environment_avoid` (readiness reason passed through verbatim),
  `no_directional_edge`, `extreme_risk`, `lifecycle_invalidated`.
- [ ] **Step 4:** pass. **Step 5:** gates. **Step 6:** commit `feat(mtf): M9 environment gate + decision test fixtures`.

---

### Task 5: Risk tier ladder

**Files:** Create `lib/mtf/decision/riskTier.ts`; Test `lib/mtf/decision/riskTier.test.ts`

**Interfaces — Produces:**
```typescript
export function riskTierOf(market: MarketIntelligenceResult, gatePassed: boolean): { tier: RiskTier; capped: boolean }
```

- [ ] **Step 1: Failing tests** (via `mkMarket`): gate failed → `{ tier:'none', capped:false }`;
  excellent/low/empirical → `full`; excellent/low/**prior** → `{ tier:'half', capped:true }` (the honesty cap);
  good/medium → `half` (capped:false — cap only bites on `full`); average/medium → `quarter`;
  excellent/high → `quarter` (risk rank breaks the full rung); good/low/prior → `half`, capped:false.
- [ ] **Step 2:** FAIL. **Step 3: Implement** with rank maps
  `QUALITY_RANK = {excellent:4, good:3, average:2, poor:1, dangerous:0}`,
  `RISK_RANK = {very_low:0, low:1, medium:2, high:3, extreme:4}`; ladder per spec; cap:
  ladder chose `full` ∧ `market.headline.calibration === 'prior'` → `PRIOR_TIER_CAP`, `capped: true`.
- [ ] **Step 4–6:** pass, gates, commit `feat(mtf): M9 risk tier ladder with prior-calibration cap`.

---

### Task 6: SMC confluence refiner

**Files:** Create `lib/mtf/decision/smcConfluence.ts`; Test `lib/mtf/decision/smcConfluence.test.ts`

**Interfaces — Produces:**
```typescript
export function applySmcConfluence(
  setup: TradeSetup, side: TradeSide, lastClose: number, objects: SmcSnapshot['objects'],
): { setup: TradeSetup; notes: ConfluenceNote[]; warnings: DecisionSignal[] }
```
Takes `objects` (not the whole snapshot) so tests need NO SmcSnapshot cast — build `SmcObject[]` with a small factory. Eligible states: `'active' | 'tested'`. OB/FVG matched by `direction` (`'bullish'` supports long); liquidity pools matched by geometry only. Rebuild every adjustment through Task 3's `assembleSetup` — never mutate numbers by hand.

- [ ] **Step 1:** SmcObject test factory:

```typescript
const obj = (o: Partial<SmcObject> & Pick<SmcObject, 'kind' | 'direction' | 'top' | 'bottom' | 'state'>): SmcObject => ({
  id: 'x', scope: 'swing', createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
  touches: 0, strength: 50, quality: 50, confidence: 50, ...o,
});
```

- [ ] **Step 2: Failing tests** — all on the canonical LONG core setup (zone [105,105.5], stop 103, target1 111, atr 2, lastClose 107):
  - **Entry snap:** bullish `orderBlock` [104.6, 105.3] (overlaps zone) → zone [104.6, 105.3], entry source `smc_orderblock`, stop distancePct **1.86**, target1 rr **3.10**, target2 **108.85**; note `{ code:'ENTRY_SNAPPED_OB', field:'entry', before:105.25, after:104.95 }` (before/after = zone midpoints).
  - **Snap tolerance:** OB [103.2, 103.9] — gap 1.1 > 0.5·ATR = 1.0 → untouched, no notes.
  - **Stop extension:** `liquidityPool` level 102.5 (top=bottom, below stop, within 0.75·ATR = 1.5) → stop **102.3** (source `smc_liquidity`), distancePct **2.80**, target1 rr **1.95**, target2 **111.15**; note `STOP_EXTENDED_LIQUIDITY` before 103 after 102.3 + warning `STOP_HUNT_RISK`.
  - **Extension bound:** pool 101 — 2 > 1.5 → untouched.
  - **Target upgrade:** opposing pool 109 (between zone top and 111, rr 3.75/2.25 = **1.67** ≥ minRR) → target1 `{ price:109, source:'smc_liquidity', rr:1.67 }`; note `TARGET_LIQUIDITY` before 111 after 109.
  - **Upgrade rejection:** pool 107 → rr 0.78 < 1.5 → untouched (111 stays).
  - **Identity invariants:** `[]` → deep-equal input setup, empty notes/warnings; state `'mitigated'` object → same.
- [ ] **Step 3:** FAIL. **Step 4: Implement** — order: entry snap (nearest eligible OB/FVG whose band overlaps or sits within `smcSnapToleranceAtrMult·atr` of the zone) → stop extension (deepest eligible pool strictly beyond stop within `stopExtendMaxAtrMult·atr`; new stop = pool ∓ `stopBufferAtrMult·atr`) → target upgrade (nearest opposing pool between zone edge and current target1, accepted only if resulting rr ≥ `minRR`). Each step re-runs `assembleSetup` with the adjusted piece; short side mirrors all comparisons.
- [ ] **Step 5–7:** pass, gates, commit `feat(mtf): M9 SMC confluence refiner (bounded, additive, audited)`.

---

### Task 7: Explanation + orchestrator

**Files:** Create `lib/mtf/decision/explanation.ts`, `lib/mtf/decision/decisionEngine.ts`; Test `lib/mtf/decision/decisionEngine.test.ts` (+ `explanation.test.ts` for banned vocab)

**Interfaces — Produces (the public M9 surface):**
```typescript
export const DECISION_SCHEMA_VERSION = 1;
export function computeTradeDecision(
  intel: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: SmcSnapshot,
): TradeDecisionResult
export function computeFullTradeDecision(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: SmcSnapshot,
): { decision: TradeDecisionResult; intel: FullMarketIntelligence }
```

- [ ] **Step 1: Failing tests:**
  - **executionTf selection** (mirrors `deriveTradeContext`, local helper): perTimeframe with triggers 15m auth 65 / 5m auth 61 → `'15m'`; no triggers → lowest `tfWeight` entry; empty perTimeframe → controller.
  - **Environment-blocked:** `mkMarket({ readiness: { state:'wait', reason:'x' } })` → action `no_trade`, gate blockedBy `environment_wait`, setup null, riskTier `none`, direction still echoed, diagnostics `{ atr:null, swingHigh:null, swingLow:null, rawRR:null, smcApplied:false }`.
  - **Happy path long:** ready/bullish/low-risk market + LONG fixture under the execution TF → action `long`, setup exactly the Task 3 canonical values, riskTier from ladder, calibration propagated, `DECISION_MODEL_PRIORS` info signal present while prior, `TIER_CAPPED_PRIOR` present iff capped.
  - **Structural invariants:** `setup === null ⟺ action === 'no_trade' ⟺ riskTier === 'none'`; `gate.passed === (action !== 'no_trade')`.
  - **insufficient_data:** execution TF absent, or 19 closed bars (< minCandles).
  - **SMC re-gate:** happy-path + pool 102.49-ish crafted so refined rr < minRR? (with canonical numbers extension gives rr 1.95 ≥ 1.5 — craft a pool at the max extension bound AND a target-upgrade pool such that combined rr < 1.5; if not constructible with the canonical fixture, assert instead that refined rr is re-checked by feeding a doctored setup through the orchestrator path via the RR-TOO-LOW fixture + entry-snap object that lowers rr below 1.5). The assertion that matters: a post-refinement rr < minRR yields `no_trade`/`rr_too_low` with `diagnostics.rawRR` = refined rr.
  - **Determinism:** two calls, deep-equal.
  - **Closed-bar:** mutate ONLY the last (forming) bar of the execution TF → output unchanged.
  - **explanation.test.ts:** banned-vocab regex over `explanation`, all signal/warning messages, and every level description, for both a trade and a no_trade result.
- [ ] **Step 2:** FAIL. **Step 3: Implement** per the spec flow: environment gate → closed-bar slice (`length > 1 ? slice(0,-1) : identity`) → minCandles check → `buildSetup` → optional `applySmcConfluence(setup, side, lastClose, smc.objects)` → rr re-gate → `riskTierOf` → explanation/signals/diagnostics. `computeFullTradeDecision` = `computeFullMarketIntelligence(candlesByTf)` then `computeTradeDecision`. Explanation sentences (exact wording, banned-vocab-safe):
  - no_trade: `` `No trade: ${gate.reason}.` ``
  - trade: `` `Setup proposed on ${TF_LABEL}: ${side} entry ${zone[0]}–${zone[1]} (${type}), stop ${stop.price} (${distancePct}%), first target ${targets[0].price} (RR ${rr}).` ``
  - `` `Invalid ${side === 'long' ? 'below' : 'above'} ${stop.price} — the stop is the invalidation.` ``
  - `` `Risk tier: ${tier}.` `` (+ `` `Capped while probabilities run on model priors.` `` when capped)
- [ ] **Step 4–6:** pass, gates, commit `feat(mtf): M9 orchestrator — computeTradeDecision + computeFullTradeDecision`.

---

### Task 8: Docs, memory, invisibility check

**Files:** Modify `docs/architecture/market-intelligence-pipeline.md`; memory `mtf-engine.md` + `MEMORY.md` hook line.

- [ ] **Step 1:** Constitution: roadmap table M9 → `✅ shipped` (M10 → `← next`); add an M9 section (responsibility, public contract, gate rungs table, invariants, depends-on M8-only edge, honesty rules: tier cap, calibration propagation, stop-is-invalidation). Title stays "(M0–M9)".
- [ ] **Step 2:** Invisibility check: `git diff --name-only <plan-commit>..HEAD | grep -v '^lib/mtf/decision/' | grep -v '^docs/'` → MUST be empty.
- [ ] **Step 3:** Full gates one last time. Commit `docs(mtf): constitution through M9`.
- [ ] **Step 4:** Update memory `mtf-engine.md` (M9 COMPLETE entry: formulas, fixture trick — constant-range candles ⇒ ATR exactly 2, spec amendment story: substitution rule made rung 7 unfireable) + `MEMORY.md` index line.

## Self-review notes (already applied)

- Spec coverage: contract→T1, swings→T2, levels+amended target rule→T3, gate rungs 1–4→T4 / 5–7→T3+T7, tiers+cap→T5, refiner+identity→T6, entry points+invariants+banned vocab+determinism+closed-bar→T7, docs→T8. Non-goals untouched.
- Type consistency: `assembleSetup`/`buildSetup`/`applySmcConfluence`/`riskTierOf`/`environmentGate` signatures are defined once (Interfaces blocks) and used identically in T6/T7.
- Known judgment call for the implementer: the SMC re-gate test (T7) may need a crafted object combination; the invariant, not the specific fixture, is the requirement.
