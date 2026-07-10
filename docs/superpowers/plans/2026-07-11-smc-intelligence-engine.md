# SMC Intelligence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (this project forbids subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless, deterministic SMC engine (`computeSmc(candles, config) → SmcSnapshot`) in `lib/smc/` with LuxAlgo-faithful detection, lifecycle/scoring intelligence, plus a render-only chart overlay indicator.

**Architecture:** One sequential bar-by-bar pass (Pine `var` semantics) behind a pure batch API. Each module is a factory returning an `onBar(i)` processor over a shared pass context; `engine.ts` orchestrates and assembles `{metadata, state, objects, events, scores, diagnostics}`. The overlay adapter maps the snapshot to existing `IndicatorResult` primitives and never computes.

**Tech Stack:** TypeScript (strict), vitest, existing `lib/indicatorFramework.ts` + `lib/testing/` harness. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-smc-intelligence-engine-design.md`. Pine reference: `~/Downloads/SDD.md` (frozen; line refs below point at it).

## Global Constraints

- Detection semantics must match the LuxAlgo script exactly (spec §5); intelligence (lifecycle beyond LuxAlgo delete-rules, sweeps, scoring) is additive and must not alter detection.
- `lib/smc/**` is headless: no imports from components/, no colors, no drawing concepts.
- No module-level mutable state; all state lives in per-pass objects. Same input ⇒ identical output, including object `id`s.
- Object ids: `${kind}_${scope ?? 'x'}_${direction}_${createdAtBar}` (e.g. `orderBlock_internal_bullish_412`).
- All scores clamped to integer 0–100.
- Performance: full pass ≤ 50 ms for 5 000 candles (checked in engine test).
- Tests: vitest, colocated. Commit after every green task: `feat(smc): <task>`.
- Candle type: `{ time, open, high, low, close, volume }` from `lib/types.ts` (time = unix seconds).

---

### Task 1: Types, config, ids

**Files:**
- Create: `lib/smc/types.ts`
- Test: `lib/smc/types.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/types`.
- Produces (used by every later task — exact names):

```ts
export const BULLISH = 1, BEARISH = -1;
export type Bias = 1 | -1 | 0;
export type SmcDirection = 'bullish' | 'bearish';
export type SmcScope = 'swing' | 'internal';
export type SmcLifecycle = 'active' | 'tested' | 'partial' | 'mitigated' | 'invalidated' | 'archived';
export type SmcObjectKind = 'orderBlock' | 'fvg' | 'liquidityPool' | 'structureLevel' | 'zone';

export interface SmcObject {
  id: string;
  kind: SmcObjectKind;
  scope?: SmcScope;
  direction: SmcDirection;
  top: number;
  bottom: number;
  createdAtBar: number;
  createdAtTime: number;
  updatedAtBar: number;
  state: SmcLifecycle;
  touches: number;
  strength: number;
  quality: number;
  confidence: number;
}

export type SmcEventType =
  | 'BOS' | 'CHOCH' | 'SWING_FORMED'
  | 'OB_CREATED' | 'OB_TESTED' | 'OB_MITIGATED'
  | 'FVG_CREATED' | 'FVG_FILLED'
  | 'EQH_FORMED' | 'EQL_FORMED' | 'LIQUIDITY_SWEEP'
  | 'ZONE_CHANGED';

export interface SmcEvent {
  id: string;               // `${type}_${barIndex}` (+ `_${scope}` when scoped)
  type: SmcEventType;
  barIndex: number;
  time: number;
  direction: SmcDirection;
  scope?: SmcScope;
  objectId?: string;
  price: number;
}

export interface InstitutionalWeights {
  structure: number; liquidity: number; orderBlocks: number; fvg: number; premiumDiscount: number;
}

export interface SmcConfig {
  version: string;                      // '1.0'
  swingsLength: number;                 // 50
  internalLength: number;               // 5
  eqLength: number;                     // 3
  eqThreshold: number;                  // 0.1
  obFilter: 'atr' | 'range';            // 'atr'
  obMitigation: 'highlow' | 'close';    // 'highlow'
  maxInternalOrderBlocks: number;       // 5
  maxSwingOrderBlocks: number;          // 5
  fvgAutoThreshold: boolean;            // true
  fvgExtend: number;                    // 1
  weights: InstitutionalWeights;        // {30,25,25,10,10}
  maxAgeBars: number;                   // 500
  sweepConfirmBars: number;             // 2
}
export const DEFAULT_SMC_CONFIG: SmcConfig;
export function resolveSmcConfig(partial?: Partial<SmcConfig>): SmcConfig;

export type SetupState = 'none' | 'watch' | 'building' | 'ready' | 'confirmed' | 'exhausted' | 'invalidated';
export type ZoneName = 'premium' | 'equilibrium' | 'discount';

export interface SmcScores {
  structure: number; liquidity: number; orderBlocks: number; fvg: number;
  premiumDiscount: number; confluence: number; institutional: number;
}

export interface SmcSnapshot {
  metadata: { version: string; config: SmcConfig };
  state: {
    swingTrend: Bias; internalTrend: Bias; zone: ZoneName;
    trailing: { top: number; bottom: number; barIndex: number; barTime: number; lastTopTime: number; lastBottomTime: number };
    setup: SetupState; setupDirection: SmcDirection | null;
  };
  objects: {
    orderBlocks: SmcObject[]; fvgs: SmcObject[]; liquidityPools: SmcObject[];
    structureLevels: SmcObject[]; zones: SmcObject[];
  };
  events: SmcEvent[];
  scores: SmcScores;
  diagnostics: { barsProcessed: number; computeMs: number; version: string; warnings: string[] };
}

export function smcObjectId(kind: SmcObjectKind, scope: SmcScope | undefined, direction: SmcDirection, createdAtBar: number): string;
```

- [ ] **Step 1: Write the failing test** (`lib/smc/types.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SMC_CONFIG, resolveSmcConfig, smcObjectId } from './types';

describe('smc types', () => {
  it('default config matches LuxAlgo script defaults', () => {
    expect(DEFAULT_SMC_CONFIG).toMatchObject({
      version: '1.0', swingsLength: 50, internalLength: 5, eqLength: 3, eqThreshold: 0.1,
      obFilter: 'atr', obMitigation: 'highlow',
      maxInternalOrderBlocks: 5, maxSwingOrderBlocks: 5,
      fvgAutoThreshold: true, fvgExtend: 1, maxAgeBars: 500, sweepConfirmBars: 2,
      weights: { structure: 30, liquidity: 25, orderBlocks: 25, fvg: 10, premiumDiscount: 10 },
    });
  });
  it('resolveSmcConfig merges partials without mutating defaults', () => {
    const cfg = resolveSmcConfig({ swingsLength: 20 });
    expect(cfg.swingsLength).toBe(20);
    expect(cfg.internalLength).toBe(5);
    expect(DEFAULT_SMC_CONFIG.swingsLength).toBe(50);
  });
  it('object ids are deterministic', () => {
    expect(smcObjectId('orderBlock', 'internal', 'bullish', 412)).toBe('orderBlock_internal_bullish_412');
    expect(smcObjectId('liquidityPool', undefined, 'bearish', 9)).toBe('liquidityPool_x_bearish_9');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/smc/types.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement `lib/smc/types.ts`** — the interfaces above verbatim, plus:

```ts
export const DEFAULT_SMC_CONFIG: SmcConfig = {
  version: '1.0',
  swingsLength: 50, internalLength: 5, eqLength: 3, eqThreshold: 0.1,
  obFilter: 'atr', obMitigation: 'highlow',
  maxInternalOrderBlocks: 5, maxSwingOrderBlocks: 5,
  fvgAutoThreshold: true, fvgExtend: 1,
  weights: { structure: 30, liquidity: 25, orderBlocks: 25, fvg: 10, premiumDiscount: 10 },
  maxAgeBars: 500, sweepConfirmBars: 2,
};

export function resolveSmcConfig(partial?: Partial<SmcConfig>): SmcConfig {
  return { ...DEFAULT_SMC_CONFIG, ...partial, weights: { ...DEFAULT_SMC_CONFIG.weights, ...partial?.weights } };
}

export function smcObjectId(kind: SmcObjectKind, scope: SmcScope | undefined, direction: SmcDirection, createdAtBar: number): string {
  return `${kind}_${scope ?? 'x'}_${direction}_${createdAtBar}`;
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
```

- [ ] **Step 4: Run** `npx vitest run lib/smc/types.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `git add lib/smc && git commit -m "feat(smc): types, config, deterministic ids"`

---

### Task 2: Volatility parsing

**Files:**
- Create: `lib/smc/volatility.ts`
- Test: `lib/smc/volatility.test.ts`

**Interfaces:**
- Consumes: `Candle`, nothing else.
- Produces:

```ts
export interface VolatilityContext {
  atr200: number[];        // Wilder ATR(200), NaN until seeded (bar 0 = high-low)
  measure: number[];       // per config.obFilter: atr200 OR cumulative mean TR (ta.cum(tr)/bar_index, Pine SDD.md:317)
  parsedHighs: number[];   // highVolatilityBar ? low : high   (SDD.md:319-323)
  parsedLows: number[];    // highVolatilityBar ? high : low
  isHighVolatility: boolean[]; // (high-low) >= 2*measure
}
export function computeVolatility(candles: Candle[], obFilter: 'atr' | 'range'): VolatilityContext;
```

- Pine parity notes: ATR = Wilder RMA of true range, length 200 (reuse the RMA recurrence used in `components/ChartPanel.tsx` `atr14Last`, generalized). Cumulative mean range at bar i (1-based Pine `bar_index` starts 0): `cumTR(0..i) / i`, guarding i=0 with `NaN` treated as no-high-volatility.

- [ ] **Step 1: Failing test** (`lib/smc/volatility.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { computeVolatility } from './volatility';
import type { Candle } from '@/lib/types';

const bar = (h: number, l: number, c: number, o = c): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: c, volume: 1 });

describe('computeVolatility', () => {
  it('marks a bar as high-volatility when range >= 2x measure and swaps parsed H/L', () => {
    // 30 calm bars (range 1) then one spike bar (range 10)
    const candles: Candle[] = [...Array.from({ length: 30 }, (_, i) => bar(101, 100, 100.5)), bar(110, 100, 105)];
    candles.forEach((c, i) => (c.time = i * 60));
    const v = computeVolatility(candles, 'atr');
    const last = candles.length - 1;
    expect(v.isHighVolatility[last]).toBe(true);
    expect(v.parsedHighs[last]).toBe(100);  // swapped: low
    expect(v.parsedLows[last]).toBe(110);   // swapped: high
    expect(v.isHighVolatility[5]).toBe(false);
    expect(v.parsedHighs[5]).toBe(101);
  });
  it('range filter uses cumulative mean true range', () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({ ...bar(101, 100, 100.5), time: i * 60 }));
    const v = computeVolatility(candles, 'range');
    // TR is 1 every bar => cum mean stays 1 => measure[9] === 1
    expect(v.measure[9]).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/smc/volatility.test.ts` — FAIL.
- [ ] **Step 3: Implement** — single loop computing TR, Wilder RMA(200) (seed = first TR, `atr = (atr*199 + tr)/200`), cumulative TR mean, then `isHighVolatility[i] = Number.isFinite(measure[i]) && (high-low) >= 2*measure[i]`, parsed arrays per the swap rule.
- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** `feat(smc): volatility parsing (ATR200 / cum mean range, parsed H/L)`

---

### Task 3: Swings

**Files:**
- Create: `lib/smc/swings.ts`
- Test: `lib/smc/swings.test.ts`

**Interfaces:**
- Consumes: `Candle[]`.
- Produces (used by marketStructure, liquidity):

```ts
export interface PivotState {          // Pine `pivot` UDT (SDD.md:220-225)
  currentLevel: number;                // NaN until first pivot
  lastLevel: number;
  crossed: boolean;
  barTime: number;
  barIndex: number;
}
export interface SwingUpdate {
  kind: 'high' | 'low';
  level: number;                       // price of the pivot
  barIndex: number;                    // i - size (the pivot bar)
  barTime: number;
  label: 'HH' | 'LH' | 'LL' | 'HL';    // vs previous same-side pivot
}
export interface SwingTracker {
  high: PivotState;
  low: PivotState;
  /** Call once per bar i (i >= size). Returns update when a NEW pivot forms this bar, else null. */
  onBar(i: number): SwingUpdate | null;
}
export function createSwingTracker(candles: Candle[], size: number): SwingTracker;
```

- Faithful port of `leg()` + `getCurrentStructure()` pivot bookkeeping (SDD.md:337-346, 409-457): `leg` flips to bearish when `high[i-size] > max(high[i-size+1..i])`, to bullish when `low[i-size] < min(low[i-size+1..i])`; a pivot forms on leg *change*. On new pivot: `lastLevel = currentLevel; currentLevel = high/low[i-size]; crossed = false; barTime/barIndex = of bar i-size`. Label: high pivot ⇒ `currentLevel > lastLevel ? 'HH' : 'LH'`; low pivot ⇒ `currentLevel < lastLevel ? 'LL' : 'HL'` (NaN lastLevel ⇒ 'HH'/'LL').

- [ ] **Step 1: Failing test** — synthetic zig-zag where pivots are hand-checkable:

```ts
import { describe, it, expect } from 'vitest';
import { createSwingTracker } from './swings';
import type { Candle } from '@/lib/types';

/** Triangle wave: rises to 110 at i=10, falls to 90 at i=30, rises to 120 at i=50. */
function triangle(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i <= 10; i++) closes.push(100 + i);          // 100..110
  for (let i = 1; i <= 20; i++) closes.push(110 - i);          // ..90
  for (let i = 1; i <= 30; i++) closes.push(90 + i);           // ..120
  return closes.map((c, i) => ({ time: i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
}

describe('createSwingTracker', () => {
  it('detects the 110 swing high and 90 swing low with size 5', () => {
    const candles = triangle();
    const tracker = createSwingTracker(candles, 5);
    const updates = [];
    for (let i = 5; i < candles.length; i++) {
      const u = tracker.onBar(i);
      if (u) updates.push(u);
    }
    const high = updates.find((u) => u.kind === 'high');
    const low = updates.find((u) => u.kind === 'low');
    expect(high).toBeDefined();
    expect(high!.level).toBeCloseTo(110.5); // high of the i=10 bar
    expect(high!.barIndex).toBe(10);
    expect(low).toBeDefined();
    expect(low!.level).toBeCloseTo(89.5);   // low of the i=30 bar
    expect(low!.barIndex).toBe(30);
    expect(low!.label).toBe('LL');
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** faithful port. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): swing/pivot tracker (faithful leg detection)`

---

### Task 4: Market structure (BOS/CHoCH, trends, trailing extremes)

**Files:**
- Create: `lib/smc/marketStructure.ts`
- Test: `lib/smc/marketStructure.test.ts`

**Interfaces:**
- Consumes: `SwingTracker`/`PivotState` (Task 3), types (Task 1).
- Produces:

```ts
export interface TrailingExtremes {    // SDD.md:181-187, 709-713
  top: number; bottom: number; barIndex: number; barTime: number;
  lastTopTime: number; lastBottomTime: number;
}
export interface StructureEngine {
  swingTrend: Bias;                    // updated on swing breaks
  internalTrend: Bias;
  trailing: TrailingExtremes;
  structureLevels: SmcObject[];        // kind 'structureLevel'; active = uncrossed pivot levels
  /** Per bar: updates pivots via trackers, detects crossovers, emits events + structure objects.
   *  Also returns break info consumed by orderBlocks in the same bar. */
  onBar(i: number): StructureBreak[];
}
export interface StructureBreak {
  scope: SmcScope; direction: SmcDirection; tag: 'BOS' | 'CHOCH';
  pivot: { level: number; barIndex: number; barTime: number };
}
export function createStructureEngine(
  candles: Candle[], cfg: SmcConfig, events: SmcEvent[],
): StructureEngine;
```

- Faithful port of `displayStructure()` (SDD.md:551-612), minus drawing:
  - Bullish break: `close[i-1] <= level && close[i] > level` (ta.crossover) on an uncrossed high pivot ⇒ tag = trend bias === BEARISH ? 'CHOCH' : 'BOS'; set `crossed = true`, trend = BULLISH. Internal scope requires `internalHigh.currentLevel !== swingHigh.currentLevel` (confluence filter input is off by default — omit the bar-shape filter entirely in v1, matching default `internalFilterConfluenceInput = false`).
  - Bearish mirror with crossunder on low pivot.
  - Swing tracker sizes: `cfg.swingsLength` (swing) and `cfg.internalLength` (internal). Equal-H/L tracker (size `cfg.eqLength`) lives in Task 5, NOT here.
  - Trailing extremes: on new swing pivot, snap `trailing.top/bottom/barIndex/barTime` (SDD.md:429-433, 450-454); every bar after both seeds, `top = max(top, high)`, `bottom = min(bottom, low)` with lastTopTime/lastBottomTime updates (SDD.md:709-713).
  - Events: `SWING_FORMED` on each swing-scope pivot (objectId of its structureLevel), `BOS`/`CHOCH` with scope + price = pivot level.
  - structureLevel objects: created `active` on pivot; on break ⇒ `state = 'mitigated'`, `updatedAtBar = i`. Strength/quality/confidence left 0 here (Task 8 fills them).

- [ ] **Step 1: Failing test** — reuse `triangle()` shape but extended so a break occurs; assert: first bullish break of the 110-level is CHoCH when trend was bearish, trend flips, second break in same direction is BOS; internal + swing scopes produce separate events; trailing extremes track the running max/min.

```ts
import { describe, it, expect } from 'vitest';
import { createStructureEngine } from './marketStructure';
import { resolveSmcConfig } from './types';
import type { Candle, } from '@/lib/types';
import type { SmcEvent } from './types';

function wave(): Candle[] {
  // 100→110 (i=0..10), →90 (i=11..30), →120 (i=31..60): the rise through 110.5 breaks the swing high
  const closes: number[] = [];
  for (let i = 0; i <= 10; i++) closes.push(100 + i);
  for (let i = 1; i <= 20; i++) closes.push(110 - i);
  for (let i = 1; i <= 30; i++) closes.push(90 + i);
  return closes.map((c, i) => ({ time: i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
}

describe('createStructureEngine', () => {
  it('emits internal CHoCH/BOS events and flips trend on breaks', () => {
    const candles = wave();
    const events: SmcEvent[] = [];
    const cfg = resolveSmcConfig({ swingsLength: 8, internalLength: 5 });
    const eng = createStructureEngine(candles, cfg, events);
    for (let i = 0; i < candles.length; i++) eng.onBar(i);
    const internalBull = events.filter((e) => (e.type === 'BOS' || e.type === 'CHOCH') && e.scope === 'internal' && e.direction === 'bullish');
    expect(internalBull.length).toBeGreaterThan(0);
    expect(eng.internalTrend).toBe(1);
    expect(eng.trailing.top).toBeCloseTo(120.5);
    expect(eng.trailing.bottom).toBeCloseTo(89.5);
    // a broken level is mitigated
    const broken = eng.structureLevels.filter((l) => l.state === 'mitigated');
    expect(broken.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): market structure engine (BOS/CHoCH, trends, trailing extremes)`

---

### Task 5: Liquidity (EQH/EQL + sweeps)

**Files:**
- Create: `lib/smc/liquidity.ts`
- Test: `lib/smc/liquidity.test.ts`

**Interfaces:**
- Consumes: `createSwingTracker` (size `cfg.eqLength`), `VolatilityContext.atr200`, types.
- Produces:

```ts
export interface LiquidityEngine {
  pools: SmcObject[];                  // kind 'liquidityPool'; direction bearish = EQH (buy-side above), bullish = EQL
  onBar(i: number): void;
}
export function createLiquidityEngine(
  candles: Candle[], cfg: SmcConfig, atr200: number[], events: SmcEvent[],
): LiquidityEngine;
```

- EQH/EQL detection faithful to SDD.md:419, 440: when the eq-tracker forms a new pivot and `|prevLevel − newLevel| < eqThreshold × atr200[i]` ⇒ pool object at band `[min, max]` of the two levels, event `EQH_FORMED` (high side, direction 'bearish') / `EQL_FORMED` (direction 'bullish').
- Sweep (intelligence, spec §5): pool is `active`; if a bar's high (EQH) pierces `top` but close is back below `top` within `cfg.sweepConfirmBars` bars of the pierce ⇒ `state='mitigated'`, event `LIQUIDITY_SWEEP` (direction = against the pierce: EQH sweep ⇒ 'bearish'). If close holds beyond the level instead ⇒ `state='invalidated'` (a true break, not a sweep). Track `touches` on each pierce.

- [ ] **Step 1: Failing test** — two hand-built scenes: (a) two equal highs within threshold ⇒ EQH pool; (b) wick through the pool + close back inside ⇒ LIQUIDITY_SWEEP + pool mitigated; (c) close through and stay ⇒ invalidated, no sweep event. Use flat candles with two spikes to identical highs (e.g. 105.0 and 105.05, ATR ≈ 1, threshold 0.1 ⇒ eq), then a spike bar high 105.6/close 103.

```ts
// assertions:
// expect(pools[0].direction).toBe('bearish'); expect(pools[0].state).toBe('active');
// after sweep bar: expect(pools[0].state).toBe('mitigated');
// expect(events.some(e => e.type === 'LIQUIDITY_SWEEP' && e.direction === 'bearish')).toBe(true);
```

Write the full fixture in the test file — flat bars `close 100, high 100.5, low 99.5`, spike bars at i=10 and i=16 with high 105 and 105.05 (eqLength 3 so pivots confirm 3 bars later), sweep bar at i=24 with high 105.6, close 103.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): liquidity engine (EQH/EQL pools + sweep detection)`

---

### Task 6: Order blocks

**Files:**
- Create: `lib/smc/orderBlocks.ts`
- Test: `lib/smc/orderBlocks.test.ts`

**Interfaces:**
- Consumes: `StructureBreak[]` (Task 4), `VolatilityContext.parsedHighs/parsedLows` (Task 2), types.
- Produces:

```ts
export interface OrderBlockEngine {
  blocks: SmcObject[];                 // kind 'orderBlock', newest first (Pine unshift)
  /** Call AFTER structure.onBar(i); pass its returned breaks. */
  onBar(i: number, breaks: StructureBreak[]): void;
}
export function createOrderBlockEngine(
  candles: Candle[], cfg: SmcConfig, vol: VolatilityContext, events: SmcEvent[],
): OrderBlockEngine;
```

- Creation faithful to `storeOrdeBlock` (SDD.md:507-525): on a bullish break, scan `parsedLows[pivot.barIndex .. i]` for the minimum ⇒ that bar's `parsedHighs/parsedLows` become the band; bearish break scans `parsedHighs` for the maximum. Object `scope` = break scope, `direction` = break direction. Cap stored blocks at 100 per scope (drop oldest). Event `OB_CREATED`.
- Mitigation faithful to `deleteOrderBlocks` (SDD.md:481-500): bearish OB mitigated when mitigation source (`close` or `high` per cfg) `> top`; bullish when (`close` or `low`) `< bottom` ⇒ `state='mitigated'`, event `OB_MITIGATED`. Run every bar over active blocks of both scopes.
- Lifecycle (intelligence): on a bar whose low/high trades into the band without mitigation ⇒ `touches++`, first touch flips `active → tested` + event `OB_TESTED`; close inside band ⇒ `tested → partial`; age > `cfg.maxAgeBars` ⇒ `archived`.

- [ ] **Step 1: Failing test** — drive with a synthetic `StructureBreak` (no structure engine needed): candles where bar 3 has the lowest parsedLow, feed one bullish internal break with pivot.barIndex 0 at i=8 ⇒ block band = bar 3's parsed H/L; then a bar dipping into the band (tested, touches 1), then a bar closing below bottom (mitigated + event). Full fixture code in test.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): order block engine (creation, mitigation, lifecycle)`

---

### Task 7: FVG + premium/discount zones

**Files:**
- Create: `lib/smc/fvg.ts`, `lib/smc/premiumDiscount.ts`
- Test: `lib/smc/fvg.test.ts`, `lib/smc/premiumDiscount.test.ts`

**Interfaces:**

```ts
// fvg.ts
export interface FvgEngine { gaps: SmcObject[]; onBar(i: number): void; }
export function createFvgEngine(candles: Candle[], cfg: SmcConfig, events: SmcEvent[]): FvgEngine;

// premiumDiscount.ts
export interface ZoneSnapshot { zone: ZoneName; premium: SmcObject; equilibrium: SmcObject; discount: SmcObject; }
export function computeZones(trailing: TrailingExtremes, close: number, barIndex: number, barTime: number): ZoneSnapshot;
```

- FVG faithful to `drawFairValueGaps` same-TF path (SDD.md:634-649): bullish when `low[i] > high[i-2] && close[i-1] > high[i-2] && barDeltaPercent > threshold` where `barDeltaPercent = (close[i-1]-open[i-1])/(open[i-1]*100)` and threshold = `fvgAutoThreshold ? cumMean(|barDeltaPercent|)*2 : 0`; band `[high[i-2], low[i]]`. Bearish mirror. Delete rule (SDD.md:625-630) ⇒ `mitigated` when price trades through the far edge; intelligence adds `partial` when price enters but does not cross (track worst penetration ⇒ fill %, store in `touches` as whole-percent for v1). Events `FVG_CREATED`, `FVG_FILLED`.
- Zones faithful to `drawPremiumDiscountZones` (SDD.md:755-761): premium band `[0.95*top+0.05*bottom, top]`, equilibrium `[0.525*bottom+0.475*top, 0.525*top+0.475*bottom]`, discount `[bottom, 0.95*bottom+0.05*top]`; `zone` = which band contains `close` (between bands ⇒ nearest of premium/discount by midpoint comparison: above eq-top ⇒ premium side, below eq-bottom ⇒ discount side). Zone objects are rebuilt each bar (state always `active`), ids keyed on `trailing.barIndex`.

- [ ] **Step 1: Failing tests** — FVG: 3-bar fixture with an explicit gap (`high[0]=101, low[2]=103`, strong up close on bar 1, auto-threshold off via `fvgAutoThreshold:false`) ⇒ bullish gap `[101,103]`; then a bar with low 100.5 ⇒ mitigated + FVG_FILLED. Zones: trailing `{top:120, bottom:80}` ⇒ premium `[118,120]`, discount `[80,82]`, equilibrium `[99,101]` (0.525/0.475 of the 40-range), close 119 ⇒ 'premium'.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement both.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): FVG engine + premium/discount zones`

---

### Task 8: Scoring, confluence, institutional score, setup machine

**Files:**
- Create: `lib/smc/scoring.ts`, `lib/smc/confluence.ts`, `lib/smc/institutionalScore.ts`
- Test: `lib/smc/scoring.test.ts`, `lib/smc/institutionalScore.test.ts`

**Interfaces:**

```ts
// scoring.ts — pure per-object metric functions (spec §6), all return 0–100 ints
export function obStrength(displacementAtr: number): number;            // min(100, displacementAtr*25)
export function fvgStrength(gapSizeAtr: number): number;                // min(100, gapSizeAtr*50)
export function poolStrength(touches: number): number;                  // 50 + min(50, touches*25)
export function structureStrength(breakMagnitudeAtr: number): number;   // min(100, breakMagnitudeAtr*30)
export function qualityOf(obj: SmcObject, currentBar: number, maxAgeBars: number): number;
// = 100 base; -15 per touch; -floor(age/maxAgeBars*40); partial ⇒ cap 40; tested cap 70; clamp
export function confidenceOf(obj: SmcObject, swingTrend: Bias, internalTrend: Bias, zone: ZoneName): number;
// +40 direction agrees with swingTrend, +30 agrees with internalTrend,
// +30 zone-aligned (bullish obj in discount / bearish in premium; equilibrium ⇒ +15)

// confluence.ts
export interface ModuleScores { structure: number; liquidity: number; orderBlocks: number; fvg: number; premiumDiscount: number; }
export function computeModuleScores(input: {
  structureLevels: SmcObject[]; pools: SmcObject[]; blocks: SmcObject[]; gaps: SmcObject[];
  swingTrend: Bias; internalTrend: Bias; zone: ZoneName; recentEvents: SmcEvent[]; // last 20 bars
}): ModuleScores;
export function confluenceScore(m: ModuleScores, swingTrend: Bias, internalTrend: Bias): number;
// trend agreement (swing===internal && !==0 ⇒ base 60 else 30) + count of module scores ≥60 * 10, clamp

// institutionalScore.ts
export interface InstitutionalResult { institutional: number; bias: SmcDirection | null; setup: SetupState; }
export function computeInstitutional(
  m: ModuleScores, confluence: number, weights: InstitutionalWeights,
  prevSetup: SetupState, trigger: { hasDirectionalEvent: boolean; qualifyingObjectMitigatedAgainst: boolean; insideQualifyingObject: boolean; approachingQualifyingObject: boolean },
  swingTrend: Bias, internalTrend: Bias,
): InstitutionalResult;
```

- Institutional = `Σ(moduleScore × weight) / Σweights`, then ±10 confluence adjustment (`confluence ≥ 70 ⇒ +10, ≤ 30 ⇒ −10`), clamp. Bias = swingTrend if non-zero else internalTrend, mapped to direction, null when 0.
- Setup machine transitions exactly per spec §6: none→watch at ≥50 w/ direction agreement; →building ≥65 + approaching; →ready ≥75 + inside; →confirmed on ready + directional event; →exhausted when confirmed and score < 50; →invalidated from watch/building/ready when qualifying object mitigated against direction; invalidated/exhausted → none when score < 30.
- Module scores v1: each = mean of top-3 live objects' `(strength+quality+confidence)/3` for its kind (0 when none), structure additionally +15 if a BOS/CHoCH event in `recentEvents` agrees with trend; premiumDiscount = 80 if zone aligns with bias (discount+bullish / premium+bearish), 50 equilibrium, 20 misaligned.

- [ ] **Step 1: Failing tests** — table-driven: exact formula outputs for known inputs (e.g. `obStrength(2)===50`, `qualityOf` fresh object === 100, tested-once age-0 === 70 cap, `confluenceScore` with both trends bullish and 3 modules ≥60 ⇒ 90) and one setup-machine walk: none→watch→building→ready→confirmed→exhausted with scripted inputs.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(smc): scoring, confluence, institutional score + setup machine`

---

### Task 9: Engine assembly + golden + regression harness

**Files:**
- Create: `lib/smc/engine.ts`, `lib/smc/engine.golden.test.ts`, `lib/smc/__fixtures__/` (dir), `lib/smc/__fixtures__/regressions/README.md`
- Test: `lib/smc/engine.test.ts`

**Interfaces:**

```ts
// engine.ts
export function computeSmc(candles: Candle[], config?: Partial<SmcConfig>): SmcSnapshot;
```

- Orchestration per bar i: volatility precomputed → `structure.onBar(i)` → `orderBlocks.onBar(i, breaks)` → `liquidity.onBar(i)` → `fvg.onBar(i)` → zones from trailing (emit `ZONE_CHANGED` event when `zone` differs from the previous bar, direction bullish for discount / bearish for premium / keep previous direction for equilibrium) → per-bar module scores → setup machine step. After the loop: fill strength/quality/confidence on all live objects (scoring.ts), assemble snapshot with `diagnostics = { barsProcessed, computeMs: performance.now() delta, version, warnings }`.
- `engine.test.ts` asserts: determinism (two runs deep-equal), empty input ⇒ empty snapshot with warnings [], performance (5 000 `makeDeterministicCandles` ≤ 50 ms — soft-assert with console.warn + expect < 250ms hard bound to avoid CI flake).
- `engine.golden.test.ts` — snapshot golden following repo convention (`UPDATE_GOLDEN=1` refresh), serializing a **stable projection**: all events `(type, barIndex, direction, scope, price)` + final object bands/states + final scores, from `makeDeterministicCandles(600, 7)`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { computeSmc } from './engine';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

const FIXTURE = join(__dirname, '__fixtures__', 'engine.golden.json');

function projection() {
  const snap = computeSmc(makeDeterministicCandles(600, 7));
  return {
    events: snap.events.map((e) => ({ t: e.type, i: e.barIndex, d: e.direction, s: e.scope ?? null, p: +e.price.toFixed(4) })),
    objects: Object.fromEntries(Object.entries(snap.objects).map(([k, list]) => [k,
      list.map((o) => ({ id: o.id, top: +o.top.toFixed(4), bottom: +o.bottom.toFixed(4), state: o.state }))])),
    scores: snap.scores,
    state: { swingTrend: snap.state.swingTrend, internalTrend: snap.state.internalTrend, zone: snap.state.zone, setup: snap.state.setup },
  };
}

describe('smc engine golden master', () => {
  it('matches the committed golden fixture', () => {
    const current = projection();
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(current, null, 2));
    }
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });
});
```

- `__fixtures__/regressions/README.md`: instructions — every fixed detection bug adds `<slug>.json` `{ candles, expectedProjection }`; `engine.test.ts` gets a `describe('regressions')` that globs the dir (via `import.meta.glob` is Vite-only in app code — use `fs.readdirSync` in the test) and replays each.
- [ ] **Step 1: Write engine.test.ts failing tests** (determinism/empty/perf + regressions loop over empty dir).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement engine.ts.** **Step 4: Run engine.test.ts + engine.golden.test.ts** — PASS (golden records on first run; inspect the fixture manually for sanity: events non-empty, both scopes present, states varied — then commit it).
- [ ] **Step 5: Run the full suite** `npx vitest run lib/smc` — all green.
- [ ] **Step 6: Commit** `feat(smc): computeSmc engine assembly, golden + regression harness`

---

### Task 10: Chart overlay indicator

**Files:**
- Create: `lib/indicators/smcOverlay.ts`
- Modify: `lib/customIndicatorsLibrary.ts` (register entry)
- Test: `lib/indicators/smcOverlay.golden.test.ts`

**Interfaces:**
- Consumes: `computeSmc`, `SmcSnapshot`; produces `IndicatorResult` via `IndicatorComputeFn` signature.

```ts
export const computeSmcOverlay: IndicatorComputeFn; // (candles, config?) => IndicatorResult
```

- Settings inputs (registered schema): booleans `showInternal` (true), `showSwing` (true), `showOrderBlocks` (true), `showFvg` (false — script default), `showLiquidity` (true), `showZones` (false — script default), `debugMode` (false); numbers `swingsLength` (50), `internalLength` (5).
- Mapping (render-only):
  - BOS/CHoCH → `markers`: bullish `aboveBar`… **no** — position at break bar: bullish `belowBar` arrowUp text `BOS`/`CHoCH`, bearish `aboveBar` arrowDown; internal scope uses circle shape to mimic dashed/smaller.
  - OBs (top N per scope, active/tested/partial only unless debug) → `band` plots: `data[j] = j >= createdAtBar ? { upper: top, lower: bottom } : null`, colors: internal bullish `rgba(49,121,245,0.2)`, internal bearish `rgba(247,124,128,0.2)`, swing bullish `rgba(24,72,204,0.2)`, swing bearish `rgba(178,40,51,0.2)` (LuxAlgo defaults at 80 transparency).
  - FVGs → band plots `rgba(0,255,104,0.3)` / `rgba(255,0,8,0.3)`.
  - EQH/EQL pools → markers text `EQH`/`EQL` at `createdAtBar`; sweeps (debug) marker text `SWEEP`.
  - Zones (when enabled) → three band plots from `trailing.barIndex`, premium `rgba(242,54,69,0.2)`, equilibrium `rgba(135,139,148,0.2)`, discount `rgba(8,153,129,0.2)`.
  - Debug mode additionally: mitigated/archived objects at halved alpha, marker text suffixed with `state`+scores (e.g. `OB 91/52/80`).
  - `signals`: `'buy'` when setup is `ready|confirmed` with bullish bias, `'sell'` mirrored, else `'neutral'` — per bar computed only at final bar (all earlier bars `'neutral'`) for v1.
- **Caching (indicator-tick-perf rule):** module-scope `let cache: { key: string; snap: SmcSnapshot } | null`; key = `candles.length : lastClosedTime(candles[len-2]?.time) : JSON.stringify(settings)`. In-bar ticks (same closed-bar signature) reuse `snap`; only the mapping re-runs (cheap).
- Registration in `CUSTOM_INDICATORS`: `id: 'smc'`, `name: 'Smart Money Concepts (SMC)'`, compute, inputs above, plot styles for the band groups.
- [ ] **Step 1: Golden test** — `defineGoldenTest({ name: 'smcOverlay', compute: computeSmcOverlay, params: { showFvg: true, showZones: true, debugMode: false } })`. Run once to record, inspect fixture (bands + markers non-empty), commit.
- [ ] **Step 2: Implement adapter + registration.** **Step 3: Run** `npx vitest run lib/indicators/smcOverlay.golden.test.ts` — PASS. Also `npx tsc --noEmit` — no NEW errors (maRibbonTV error pre-exists).
- [ ] **Step 4: Visual verification** — dev server `/app`, add "Smart Money Concepts (SMC)" from the Indicators menu on 15m BTCUSDT; verify structure labels, OB boxes, EQH/EQL appear and update on live ticks without jank; toggle debugMode; compare side-by-side with TradingView LuxAlgo SMC on the same symbol/TF (same defaults) — BOS/CHoCH placement and OB bands should visibly match.
- [ ] **Step 5: Commit** `feat(smc): chart overlay indicator with debug mode`

---

### Task 11: Wrap-up

- [ ] Run full test suite `npx vitest run` — no regressions anywhere.
- [ ] `graphify update .`
- [ ] Update memory: add `smc-intelligence-engine` project memory (engine location, snapshot contract, golden refresh command).
