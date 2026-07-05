# Supply/Demand Trade Signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit non-repainting reversal Buy/Sell signals from the existing Supply/Demand zones, each with a configurable stop-loss, TP1/TP2 targets, a 0–100 confidence score with structured explanation, plus a backtest report and a Signals panel.

**Architecture:** A centralized **`SdSignal`** contract (its own module) is the single shared type across engine, chart, dashboard, backtester, and future alerts/AI. Two pure engines with no framework/chart/store imports — `signalEngine.ts` (evaluates when a signal fires and its levels/confidence) and `signalBacktest.ts` (aggregates resolved signals into metrics). A thin glue file `sdSignals.ts` adapts them to the chart `IndicatorResult` and is registered as a separate `sd_signals` indicator.

**Pipeline (event-driven intent):**
```
New candle closed → update zones → evaluate signals → emit SdSignal events → { chart · dashboard · backtester · (future) alerts/webhooks }
```
The pure evaluator (`generateSignals`) is the "evaluate" stage; `computeSdSignalEvents` is the emission boundary that every consumer reads. Task 10 documents the seam where a future alert bus subscribes to newly-`triggered` signals on bar close — no engine change required later.

**Tech Stack:** TypeScript, Next.js (custom build — read `node_modules/next/dist/docs/` before any page code), vitest + happy-dom, lightweight-charts v5, Tailwind (MDS tokens).

## Enhancements applied (from SDSignal.md, 2026-07-05)

- Execution: **Subagent-Driven**, on `feat/sd-signals`, no separate worktree.
- Phases **A (core engine) → B (validation) → C (integration)**; build UI only after the engine is proven.
- **Centralized `SdSignal` contract defined first** (Task 1), before the lifecycle.
- Engine kept **event-driven** at the emission boundary for future alerts/webhooks.
- Historical-confluence **approximation documented in code + user-facing text + Phase-2 TODO**.

## Global Constraints

- **Non-repainting:** all state transitions evaluated on CLOSED bars only; a `triggered` signal's entry/stopLoss/takeProfit1/takeProfit2 never change afterward. (spec §6)
- **Pure engines:** `signalTypes.ts`, `signalEngine.ts`, `signalBacktest.ts` import ONLY from `../types` and `./zoneStrength`/`./htf` types — NO imports from `indicatorFramework`, chart, or any store (mirrors `zoneStrength.ts`).
- **Reversal-only** archetype; **signals fire on the chart timeframe**; **TP1 = nearest opposing zone, TP2 = measured-move target band**; **`sd_signals` is a separate indicator** from `sd_zones`. (spec §16 locked)
- **Defaults (verbatim):** `confirmation=rejection_close`, `minTier=medium`, `confidenceFloor=55`, `minRR=1.5`, `slBufferMode=atr`, `slBuffer=0.25`, `tickSize=0.1`, `maxBarsToTrigger=20`, `maxBarsInTrade=150`; confidence weights `zoneStrength=0.35, confluence=0.20, riskReward=0.20, freshness=0.15, formationVolume=0.10`.
- **Quality gate:** emit as `triggered` only if `tier≥minTier` AND `confidence≥confidenceFloor` AND `riskReward≥minRR`; else `invalidated`.
- **Verification per task:** `npx tsc --noEmit` clean, `npx eslint <files>` clean, task tests green. Commit after each task. Branch: `feat/sd-signals` (already checked out).
- **UI freezes:** financial values via `Num.*` (B5-FREEZE), panels via `Panel` (C-FREEZE); persistent "paper & educational — not financial advice" disclaimer wherever signals show.

---

## File Structure

- `lib/indicators/signalTypes.ts` — **shared contract**: `Side`, `SdSignalStatus`, `SignalFactor`, `SignalExplanation`, `ScoredZone`, `SdSignal`.
- `lib/indicators/signalEngine.ts` — `SignalEngineConfig` + `computeStopLoss`, `computeTargets`, `computeConfidence`, `generateSignals`.
- `lib/indicators/signalEngine.test.ts` — unit tests.
- `lib/indicators/signalEngine.golden.test.ts` + `lib/testing/fixtures/signalEngine.golden.json` — determinism + non-repaint.
- `lib/indicators/signalBacktest.ts` (+ `.test.ts`) — `backtestSignals` + `BacktestReport`.
- `lib/indicators/sdSignals.ts` (+ `.test.ts`) — `buildScoredZones`, `computeSdSignalEvents`, `computeSdSignals`.
- `lib/customIndicatorsLibrary.ts` — register `sd_signals` (modify).
- `components/trade/SignalsPanel.tsx` (+ `.test.tsx`) — signals list + explanation.
- Dashboard wiring (Task 10).

---

# PHASE A — Core Engine

### Task 1: Shared `SdSignal` contract

**Files:**
- Create: `lib/indicators/signalTypes.ts`
- Test: `lib/indicators/signalTypes.test.ts`

**Interfaces:**
- Consumes: `ZoneKind`, `ZoneStrength` from `./zoneStrength`; `HtfPeriod` from `./htf`.
- Produces: `Side`, `SdSignalStatus`, `SignalFactor`, `SignalExplanation`, `ScoredZone`, `SdSignal`, `zoneIdOf(...)`, `SIGNAL_STATUSES`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalTypes.test.ts
import { describe, it, expect } from 'vitest';
import { zoneIdOf, SIGNAL_STATUSES } from './signalTypes';

describe('signalTypes', () => {
  it('zoneIdOf builds a stable id from tf, kind and formation index', () => {
    expect(zoneIdOf('D', 'demand', 42)).toBe('D:demand:42');
  });
  it('exposes the full status set', () => {
    expect(SIGNAL_STATUSES).toEqual(['armed', 'triggered', 'tp1', 'tp2', 'stopped', 'expired', 'invalidated']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalTypes.test.ts`
Expected: FAIL — module `./signalTypes` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/indicators/signalTypes.ts
// Shared signal contract — the SINGLE type used by the engine, chart,
// dashboard, backtester, and future alerts/AI. No framework/chart/store imports.
import type { ZoneKind, ZoneStrength } from './zoneStrength';
import type { HtfPeriod } from './htf';

export type Side = 'buy' | 'sell';

export type SdSignalStatus =
  | 'armed'        // price entered the zone; awaiting confirmation
  | 'triggered'    // confirmation bar closed; signal is live
  | 'tp1'          // first target hit
  | 'tp2'          // second target hit
  | 'stopped'      // stop-loss hit
  | 'expired'      // no confirm within window, or no resolution within window
  | 'invalidated'; // zone broken pre-confirm, or failed the quality gate

export const SIGNAL_STATUSES: SdSignalStatus[] = [
  'armed', 'triggered', 'tp1', 'tp2', 'stopped', 'expired', 'invalidated',
];

/** One weighted piece of evidence behind the confidence score. */
export interface SignalFactor {
  key: 'zoneStrength' | 'confluence' | 'riskReward' | 'freshness' | 'formationVolume';
  label: string;
  input: number;        // normalized 0..1
  weight: number;
  contribution: number; // weight * input * 100
}

/** Structured, renderable rationale — maps to DESIGN.md §E explainable-AI grammar. */
export interface SignalExplanation {
  factors: SignalFactor[];   // sorted by contribution desc
  summary: string;
  counterSignals: string[];
}

/** A zone annotated with score + context, consumed by the signal engine. */
export interface ScoredZone {
  kind: ZoneKind;
  zoneType: 'supply' | 'demand';
  tf: HtfPeriod;
  upper: number;
  lower: number;
  mid: number;
  formedAtIndex: number;
  formedTime: number;
  strength: ZoneStrength;
  isConfluence: boolean;
  retestCount: number;
}

/**
 * The canonical trade signal. Shared contract for every consumer.
 * `*Index` fields are bar positions on the signal (chart) timeframe used for
 * rendering; `createdAt`/`resolvedAt` are unix seconds for ordering/history.
 */
export interface SdSignal {
  id: string;                 // `${side}:${zoneId}` — stable, deduped per zone
  side: Side;
  timeframe: string;          // chart timeframe the signal is evaluated on
  symbol: string;
  zoneId: string;             // `${zoneTf}:${zoneKind}:${formedAtIndex}`
  zoneTf: HtfPeriod;
  zoneKind: 'supply' | 'demand';
  status: SdSignalStatus;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;         // (tp1-entry)/risk, sell mirrored
  confidence: number;         // 0..100
  explanation: SignalExplanation;
  tier: 'medium' | 'strong';
  armedIndex: number | null;
  triggeredIndex: number | null;
  resolvedIndex: number | null;
  createdAt: number;          // triggeredTime ?? armedTime
  resolvedAt: number | null;
}

export const zoneIdOf = (tf: HtfPeriod, kind: 'supply' | 'demand', formedAtIndex: number): string =>
  `${tf}:${kind}:${formedAtIndex}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalTypes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalTypes.ts lib/indicators/signalTypes.test.ts
git commit -m "feat(signals): centralized SdSignal shared contract"
```

---

### Task 2: Engine config + configurable stop-loss

**Files:**
- Create: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `Side` from `./signalTypes`.
- Produces: `SlBufferMode`, `ConfirmationMode`, `SignalEngineConfig`, `DEFAULT_SIGNAL_CONFIG`, `computeStopLoss(side, zone, entry, atr, cfg)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalEngine.test.ts
import { describe, it, expect } from 'vitest';
import { computeStopLoss, DEFAULT_SIGNAL_CONFIG } from './signalEngine';

const zone = { upper: 105, lower: 100 };

describe('computeStopLoss', () => {
  it('atr mode: buy stop is zone.lower minus slBuffer*atr', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(99, 6);
  });
  it('percent mode: buy stop uses % of entry', () => {
    const sl = computeStopLoss('buy', zone, 200, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'percent', slBuffer: 1 });
    expect(sl).toBeCloseTo(98, 6);
  });
  it('ticks mode: buy stop uses slBuffer*tickSize', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'ticks', slBuffer: 5, tickSize: 0.1 });
    expect(sl).toBeCloseTo(99.5, 6);
  });
  it('sell mirrors above the zone upper', () => {
    const sl = computeStopLoss('sell', zone, 104, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(106, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `computeStopLoss` / `DEFAULT_SIGNAL_CONFIG` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/indicators/signalEngine.ts
import type { Side } from './signalTypes';

export type SlBufferMode = 'atr' | 'percent' | 'ticks';
export type ConfirmationMode = 'touch' | 'rejection_close' | 'reversal_candle';

export interface SignalEngineConfig {
  confirmation: ConfirmationMode;
  minTier: 'medium' | 'strong';
  confidenceFloor: number;
  minRR: number;
  slBufferMode: SlBufferMode;
  slBuffer: number;
  tickSize: number;
  maxBarsToTrigger: number;
  maxBarsInTrade: number;
  wZoneStrength: number;
  wConfluence: number;
  wRiskReward: number;
  wFreshness: number;
  wFormationVolume: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalEngineConfig = {
  confirmation: 'rejection_close',
  minTier: 'medium',
  confidenceFloor: 55,
  minRR: 1.5,
  slBufferMode: 'atr',
  slBuffer: 0.25,
  tickSize: 0.1,
  maxBarsToTrigger: 20,
  maxBarsInTrade: 150,
  wZoneStrength: 0.35,
  wConfluence: 0.20,
  wRiskReward: 0.20,
  wFreshness: 0.15,
  wFormationVolume: 0.10,
};

export function computeStopLoss(
  side: Side,
  zone: { upper: number; lower: number },
  entry: number,
  atr: number,
  cfg: Pick<SignalEngineConfig, 'slBufferMode' | 'slBuffer' | 'tickSize'>,
): number {
  const buffer =
    cfg.slBufferMode === 'atr'
      ? cfg.slBuffer * atr
      : cfg.slBufferMode === 'percent'
        ? (cfg.slBuffer / 100) * entry
        : cfg.slBuffer * cfg.tickSize; // 'ticks'
  return side === 'buy' ? zone.lower - buffer : zone.upper + buffer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): engine config + configurable stop-loss buffer"
```

---

### Task 3: TP1/TP2 target computation

**Files:**
- Modify: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `Side`, `ScoredZone` from `./signalTypes`.
- Produces: `computeTargets(side, entry, sl, zones, triggeredIndex, minRR) => { tp1: number; tp2: number }`.

- [ ] **Step 1: Write the failing test** (append to `signalEngine.test.ts`)

```ts
import { computeTargets } from './signalEngine';
import type { ScoredZone } from './signalTypes';

const z = (over: Partial<ScoredZone>): ScoredZone => ({
  kind: 'supply', zoneType: 'supply', tf: 'D', upper: 0, lower: 0, mid: 0,
  formedAtIndex: 0, formedTime: 0, isConfluence: false, retestCount: 0,
  strength: { score: 60, tier: 'medium', factors: { formationVolume: 0.5, rejectionStrength: 0.5, retests: 0, freshness: 0.8, confluence: 0, zoneWidth: 0.5 } },
  ...over,
});

describe('computeTargets (buy at demand)', () => {
  it('TP1 = nearest supply.lower above entry, TP2 = nearest supplyTarget.upper above TP1', () => {
    const zones = [
      z({ kind: 'supply', lower: 120, upper: 125, formedAtIndex: 1 }),
      z({ kind: 'supplyTarget', lower: 125, upper: 140, formedAtIndex: 1 }),
    ];
    const { tp1, tp2 } = computeTargets('buy', 100, 98, zones, 5, 1.5);
    expect(tp1).toBe(120);
    expect(tp2).toBe(140);
  });
  it('falls back to R-multiples when no opposing zone exists', () => {
    const { tp1, tp2 } = computeTargets('buy', 100, 98, [], 5, 1.5);
    expect(tp1).toBeCloseTo(103, 6);
    expect(tp2).toBeCloseTo(106, 6);
  });
  it('ignores zones formed after the trigger (no lookahead)', () => {
    const zones = [z({ kind: 'supply', lower: 120, upper: 125, formedAtIndex: 99 })];
    const { tp1 } = computeTargets('buy', 100, 98, zones, 5, 1.5);
    expect(tp1).toBeCloseTo(103, 6);
  });
});

describe('computeTargets (sell at supply)', () => {
  it('TP1 = nearest demand.upper below entry, TP2 = nearest demandTarget.lower below TP1', () => {
    const zones = [
      z({ kind: 'demand', zoneType: 'demand', lower: 75, upper: 80, formedAtIndex: 1 }),
      z({ kind: 'demandTarget', zoneType: 'demand', lower: 60, upper: 75, formedAtIndex: 1 }),
    ];
    const { tp1, tp2 } = computeTargets('sell', 100, 102, zones, 5, 1.5);
    expect(tp1).toBe(80);
    expect(tp2).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `computeTargets` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `signalEngine.ts`; add `import type { ScoredZone } from './signalTypes';` to the existing import from that module)

```ts
export function computeTargets(
  side: Side,
  entry: number,
  sl: number,
  zones: ScoredZone[],
  triggeredIndex: number,
  minRR: number,
): { tp1: number; tp2: number } {
  const risk = Math.abs(entry - sl);
  const active = zones.filter((zn) => zn.formedAtIndex <= triggeredIndex);
  if (side === 'buy') {
    const supplies = active
      .filter((zn) => zn.kind === 'supply' && zn.lower > entry)
      .map((zn) => zn.lower)
      .sort((a, b) => a - b);
    const tp1 = supplies.length ? supplies[0] : entry + minRR * risk;
    const targets = active
      .filter((zn) => zn.kind === 'supplyTarget' && zn.upper > tp1)
      .map((zn) => zn.upper)
      .sort((a, b) => a - b);
    let tp2 = targets.length ? targets[0] : entry + 2 * (tp1 - entry);
    if (tp2 <= tp1) tp2 = tp1 + (tp1 - entry);
    return { tp1, tp2 };
  }
  const demands = active
    .filter((zn) => zn.kind === 'demand' && zn.upper < entry)
    .map((zn) => zn.upper)
    .sort((a, b) => b - a);
  const tp1 = demands.length ? demands[0] : entry - minRR * risk;
  const targets = active
    .filter((zn) => zn.kind === 'demandTarget' && zn.lower < tp1)
    .map((zn) => zn.lower)
    .sort((a, b) => b - a);
  let tp2 = targets.length ? targets[0] : entry - 2 * (entry - tp1);
  if (tp2 >= tp1) tp2 = tp1 - (entry - tp1);
  return { tp1, tp2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): TP1 opposing-zone + TP2 measured-move targets"
```

---

### Task 4: Confidence score + structured explanation

**Files:**
- Modify: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `ScoredZone`, `SignalFactor`, `SignalExplanation` from `./signalTypes`.
- Produces: `computeConfidence(zone, rr1, minRR, cfg) => { confidence: number; explanation: SignalExplanation }`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { computeConfidence, DEFAULT_SIGNAL_CONFIG as CFG } from './signalEngine';

describe('computeConfidence', () => {
  const strong = z({
    zoneType: 'demand', kind: 'demand', isConfluence: true, retestCount: 3,
    strength: { score: 90, tier: 'strong', factors: { formationVolume: 0.9, rejectionStrength: 0.8, retests: 0.3, freshness: 0.2, confluence: 1, zoneWidth: 0.6 } },
  });
  it('returns 0..100 and factors sorted by contribution desc', () => {
    const { confidence, explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(100);
    const contribs = explanation.factors.map((f) => f.contribution);
    expect(contribs).toEqual([...contribs].sort((a, b) => b - a));
  });
  it('surfaces counter-signals (high retests, stale zone)', () => {
    const { explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(explanation.counterSignals).toContain('retested 3×');
    expect(explanation.counterSignals).toContain('stale zone');
  });
  it('summary mentions the R multiple', () => {
    const { explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(explanation.summary).toMatch(/2\.1R/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `computeConfidence` not exported.

- [ ] **Step 3: Write minimal implementation** (append; add `SignalFactor, SignalExplanation` to the `./signalTypes` import)

```ts
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp100 = (x: number): number => (x < 0 ? 0 : x > 100 ? 100 : x);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const FACTOR_LABEL: Record<SignalFactor['key'], string> = {
  zoneStrength: 'Zone strength',
  confluence: 'Multi-TF confluence',
  riskReward: 'Risk/reward',
  freshness: 'Freshness',
  formationVolume: 'Formation volume',
};

export function computeConfidence(
  zone: ScoredZone,
  rr1: number,
  minRR: number,
  cfg: SignalEngineConfig,
): { confidence: number; explanation: SignalExplanation } {
  const raw: Array<Pick<SignalFactor, 'key' | 'input' | 'weight'>> = [
    { key: 'zoneStrength', input: clamp01(zone.strength.score / 100), weight: cfg.wZoneStrength },
    { key: 'confluence', input: zone.isConfluence ? 1 : 0, weight: cfg.wConfluence },
    { key: 'riskReward', input: clamp01(rr1 / 3), weight: cfg.wRiskReward },
    { key: 'freshness', input: clamp01(zone.strength.factors.freshness), weight: cfg.wFreshness },
    { key: 'formationVolume', input: clamp01(zone.strength.factors.formationVolume), weight: cfg.wFormationVolume },
  ];
  const factors: SignalFactor[] = raw
    .map((f) => ({ ...f, label: FACTOR_LABEL[f.key], contribution: f.weight * f.input * 100 }))
    .sort((a, b) => b.contribution - a.contribution);
  const confidence = clamp100(factors.reduce((s, f) => s + f.contribution, 0));

  const counterSignals: string[] = [];
  if (zone.retestCount >= 3) counterSignals.push(`retested ${zone.retestCount}×`);
  if (rr1 < minRR * 1.1) counterSignals.push('R:R near floor');
  if (zone.strength.factors.freshness < 0.3) counterSignals.push('stale zone');

  const summary =
    `${cap(zone.strength.tier)} ${zone.zoneType} zone` +
    `${zone.isConfluence ? ' with multi-TF confluence' : ''}, ${rr1.toFixed(1)}R ` +
    `(top: ${factors[0].label.toLowerCase()})`;

  return { confidence, explanation: { factors, summary, counterSignals } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): confidence score with structured explanation"
```

---

### Task 5: `generateSignals` lifecycle + resolution (emits `SdSignal[]`)

**Files:**
- Modify: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `Candle` from `../types`; `SdSignal`, `SdSignalStatus`, `ScoredZone`, `Side`, `zoneIdOf` from `./signalTypes`; `computeStopLoss`, `computeTargets`, `computeConfidence`.
- Produces: `SignalContext` (`{ symbol: string; timeframe: string }`), `generateSignals(candles, zones, atr, cfg, ctx) => SdSignal[]`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { generateSignals } from './signalEngine';
import type { Candle } from '../types';

const c = (i: number, o: number, h: number, l: number, cl: number): Candle =>
  ({ time: 1000 + i * 60, open: o, high: h, low: l, close: cl, volume: 100 } as Candle);

const demand = z({
  kind: 'demand', zoneType: 'demand', lower: 100, upper: 105, mid: 102.5,
  formedAtIndex: 0, strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
});
const supply = z({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135, formedAtIndex: 0 });

const bars: Candle[] = [
  c(0, 110, 112, 108, 111),
  c(1, 111, 112, 106, 107),
  c(2, 107, 108, 101, 103),   // enters demand -> armed
  c(3, 103, 109, 102, 108),   // close 108 > 105 -> rejection confirm -> triggered
  c(4, 108, 122, 107, 120),
  c(5, 120, 131, 119, 130),   // high 131 >= supply.lower 130 -> tp1
];
const atr = bars.map(() => 4);
const ctx = { symbol: 'BTCUSDT', timeframe: '1h' };

describe('generateSignals (buy lifecycle)', () => {
  it('arms, triggers on rejection close, resolves at TP1, carries the contract fields', () => {
    const sigs = generateSignals(bars, [demand, supply], atr, { ...CFG }, ctx);
    const s = sigs.find((e) => e.side === 'buy')!;
    expect(s.symbol).toBe('BTCUSDT');
    expect(s.timeframe).toBe('1h');
    expect(s.zoneId).toBe('D:demand:0');
    expect(s.armedIndex).toBe(2);
    expect(s.triggeredIndex).toBe(3);
    expect(s.entry).toBeCloseTo(108, 6);
    expect(s.stopLoss).toBeCloseTo(99, 6);
    expect(s.takeProfit1).toBe(130);
    expect(s.status).toBe('tp1');
    expect(s.createdAt).toBe(bars[3].time);
  });

  it('fails the R:R gate -> invalidated, never triggered', () => {
    const sigs = generateSignals(bars, [demand, supply], atr, { ...CFG, minRR: 100 }, ctx);
    const s = sigs.find((e) => e.side === 'buy')!;
    expect(s.status).toBe('invalidated');
    expect(s.triggeredIndex).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `generateSignals` not exported.

- [ ] **Step 3: Write minimal implementation** (append; extend imports: `import type { Candle } from '../types';` and add `SdSignal, SdSignalStatus, zoneIdOf` to the `./signalTypes` import)

```ts
export interface SignalContext {
  symbol: string;
  timeframe: string;
}

const TIER_RANK: Record<'weak' | 'medium' | 'strong', number> = { weak: 0, medium: 1, strong: 2 };
const inZone = (zn: { upper: number; lower: number }, bar: Candle): boolean =>
  bar.low <= zn.upper && bar.high >= zn.lower;

function isConfirmed(side: Side, zone: ScoredZone, bar: Candle, mode: ConfirmationMode): boolean {
  if (mode === 'touch') return true;
  const rejected = side === 'buy' ? bar.close > zone.upper : bar.close < zone.lower;
  if (mode === 'rejection_close') return rejected;
  const directional = side === 'buy' ? bar.close > bar.open : bar.close < bar.open; // reversal_candle
  return rejected && directional;
}

/** Pure, non-repainting. Emits one SdSignal per zone that at least armed. */
export function generateSignals(
  candles: Candle[],
  zones: ScoredZone[],
  atr: Array<number | null>,
  cfg: SignalEngineConfig,
  ctx: SignalContext,
): SdSignal[] {
  const out: SdSignal[] = [];
  const entryZones = zones.filter(
    (zn) => (zn.kind === 'demand' || zn.kind === 'supply') && TIER_RANK[zn.strength.tier] >= TIER_RANK[cfg.minTier],
  );

  for (const zone of entryZones) {
    const side: Side = zone.kind === 'demand' ? 'buy' : 'sell';
    const zoneKind: 'supply' | 'demand' = zone.kind === 'demand' ? 'demand' : 'supply';
    const zoneId = zoneIdOf(zone.tf, zoneKind, zone.formedAtIndex);

    // 1. Arm: first bar after formation that enters the zone.
    let armedIndex = -1;
    for (let i = zone.formedAtIndex + 1; i < candles.length; i++) {
      if (inZone(zone, candles[i])) { armedIndex = i; break; }
    }
    if (armedIndex === -1) continue;

    const tier: 'medium' | 'strong' = zone.strength.tier === 'strong' ? 'strong' : 'medium';
    const base: SdSignal = {
      id: `${side}:${zoneId}`, side, timeframe: ctx.timeframe, symbol: ctx.symbol,
      zoneId, zoneTf: zone.tf, zoneKind, status: 'armed',
      entry: NaN, stopLoss: NaN, takeProfit1: NaN, takeProfit2: NaN, riskReward: NaN,
      confidence: 0, explanation: { factors: [], summary: '', counterSignals: [] }, tier,
      armedIndex, triggeredIndex: null, resolvedIndex: null,
      createdAt: candles[armedIndex].time, resolvedAt: null,
    };

    // 2. Confirm within maxBarsToTrigger; a close beyond the far edge invalidates.
    let triggeredIndex = -1;
    for (let j = armedIndex; j < candles.length && j - armedIndex <= cfg.maxBarsToTrigger; j++) {
      const bar = candles[j];
      const broken = side === 'buy' ? bar.close < zone.lower : bar.close > zone.upper;
      if (broken) { out.push({ ...base, status: 'invalidated' }); triggeredIndex = -2; break; }
      if (isConfirmed(side, zone, bar, cfg.confirmation)) { triggeredIndex = j; break; }
    }
    if (triggeredIndex === -2) continue;
    if (triggeredIndex === -1) { out.push({ ...base, status: 'expired' }); continue; }

    // 3. Levels + quality gate (entry now known).
    const entry = candles[triggeredIndex].close;
    const stopLoss = computeStopLoss(side, zone, entry, atr[triggeredIndex] ?? 0, cfg);
    const { tp1, tp2 } = computeTargets(side, entry, stopLoss, zones, triggeredIndex, cfg.minRR);
    const risk = Math.abs(entry - stopLoss);
    const riskReward = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
    const { confidence, explanation } = computeConfidence(zone, riskReward, cfg.minRR, cfg);

    const gated: SdSignal = {
      ...base, entry, stopLoss, takeProfit1: tp1, takeProfit2: tp2, riskReward, confidence, explanation,
      triggeredIndex, createdAt: candles[triggeredIndex].time,
    };
    if (confidence < cfg.confidenceFloor || riskReward < cfg.minRR) {
      // Failed the quality gate: armed + confirmed but never became live, so it
      // is invalidated with no trigger (triggeredIndex stays null).
      out.push({ ...gated, status: 'invalidated', triggeredIndex: null });
      continue;
    }

    // 4. Resolve forward within maxBarsInTrade (SL first = conservative).
    let status: SdSignalStatus = 'triggered';
    let resolvedIndex: number | null = null;
    let hitTp1 = false;
    for (let k = triggeredIndex + 1; k < candles.length && k - triggeredIndex <= cfg.maxBarsInTrade; k++) {
      const bar = candles[k];
      const slHit = side === 'buy' ? bar.low <= stopLoss : bar.high >= stopLoss;
      const tp1Hit = side === 'buy' ? bar.high >= tp1 : bar.low <= tp1;
      const tp2Hit = side === 'buy' ? bar.high >= tp2 : bar.low <= tp2;
      if (slHit) { status = 'stopped'; resolvedIndex = k; break; }
      if (tp2Hit && hitTp1) { status = 'tp2'; resolvedIndex = k; break; }
      if (tp1Hit) { hitTp1 = true; status = 'tp1'; resolvedIndex = k; }
    }
    if (status === 'triggered') status = 'expired'; // triggered but never resolved in window

    out.push({
      ...gated,
      status,
      resolvedIndex,
      resolvedAt: resolvedIndex != null ? candles[resolvedIndex].time : null,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): generateSignals lifecycle emitting SdSignal[]"
```

---

# PHASE B — Validation (prove the engine before any UI)

### Task 6: Golden-master (determinism + non-repaint)

**Files:**
- Create: `lib/indicators/signalEngine.golden.test.ts`
- Create: `lib/testing/fixtures/signalEngine.golden.json` (generated in Step 3)

**Interfaces:**
- Consumes: `generateSignals`, `DEFAULT_SIGNAL_CONFIG`; `ScoredZone` from `./signalTypes`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalEngine.golden.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSignals, DEFAULT_SIGNAL_CONFIG } from './signalEngine';
import type { ScoredZone } from './signalTypes';
import type { Candle } from '../types';

const c = (i: number, o: number, h: number, l: number, cl: number): Candle =>
  ({ time: 1000 + i * 60, open: o, high: h, low: l, close: cl, volume: 100 } as Candle);

const zone = (over: Partial<ScoredZone>): ScoredZone => ({
  kind: 'demand', zoneType: 'demand', tf: 'D', upper: 105, lower: 100, mid: 102.5,
  formedAtIndex: 0, formedTime: 1000, isConfluence: false, retestCount: 0,
  strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
  ...over,
});

const bars: Candle[] = [
  c(0, 110, 112, 108, 111), c(1, 111, 112, 106, 107), c(2, 107, 108, 101, 103),
  c(3, 103, 109, 102, 108), c(4, 108, 122, 107, 120), c(5, 120, 131, 119, 130),
];
const zones = [zone({}), zone({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135 })];
const atr = bars.map(() => 4);
const ctx = { symbol: 'BTCUSDT', timeframe: '1h' };

const GOLDEN = join(__dirname, '..', 'testing', 'fixtures', 'signalEngine.golden.json');

describe('signalEngine golden', () => {
  it('matches the frozen SdSignal snapshot', () => {
    const sigs = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG, ctx);
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(sigs).toEqual(expected);
  });

  it('does not repaint: a triggered signal is identical when computed over a prefix', () => {
    const full = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG, ctx).find((e) => e.triggeredIndex === 3)!;
    const prefix = generateSignals(bars.slice(0, 5), zones, atr.slice(0, 5), DEFAULT_SIGNAL_CONFIG, ctx).find((e) => e.triggeredIndex === 3)!;
    expect(prefix.entry).toBe(full.entry);
    expect(prefix.stopLoss).toBe(full.stopLoss);
    expect(prefix.takeProfit1).toBe(full.takeProfit1);
    expect(prefix.takeProfit2).toBe(full.takeProfit2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.golden.test.ts`
Expected: FAIL — fixture missing (ENOENT).

- [ ] **Step 3: Generate the fixture and sanity-check it**

Temporarily add `console.log(JSON.stringify(sigs, null, 2))` inside the first test (after computing `sigs`), run:
`npx vitest run lib/indicators/signalEngine.golden.test.ts` — copy the printed JSON into `lib/testing/fixtures/signalEngine.golden.json` (end with a trailing newline), then remove the `console.log`. Sanity-check the buy signal shows `entry:108, stopLoss:99, takeProfit1:130, status:"tp1", zoneId:"D:demand:0"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.golden.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.golden.test.ts lib/testing/fixtures/signalEngine.golden.json
git commit -m "test(signals): golden-master + non-repaint lock"
```

---

### Task 7: Backtest report

**Files:**
- Create: `lib/indicators/signalBacktest.ts`
- Test: `lib/indicators/signalBacktest.test.ts`

**Interfaces:**
- Consumes: `SdSignal` from `./signalTypes`.
- Produces: `BacktestReport`, `BacktestSlice`, `backtestSignals(signals) => BacktestReport`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalBacktest.test.ts
import { describe, it, expect } from 'vitest';
import { backtestSignals } from './signalBacktest';
import type { SdSignal } from './signalTypes';

const base: SdSignal = {
  id: 'buy:D:demand:0', side: 'buy', timeframe: '1h', symbol: 'BTCUSDT',
  zoneId: 'D:demand:0', zoneTf: 'D', zoneKind: 'demand', status: 'tp1',
  entry: 100, stopLoss: 90, takeProfit1: 120, takeProfit2: 140, riskReward: 2, confidence: 70,
  explanation: { factors: [], summary: '', counterSignals: [] }, tier: 'strong',
  armedIndex: 1, triggeredIndex: 2, resolvedIndex: 5, createdAt: 0, resolvedAt: 5,
};

describe('backtestSignals', () => {
  it('computes win rate, avgR and profit factor over resolved signals', () => {
    const sigs: SdSignal[] = [
      { ...base, status: 'tp1', takeProfit1: 120, entry: 100, stopLoss: 90 },  // +2R
      { ...base, status: 'tp2', takeProfit2: 140, entry: 100, stopLoss: 90 },  // +4R
      { ...base, status: 'stopped', entry: 100, stopLoss: 90 },                 // -1R
      { ...base, status: 'expired' },                                            // excluded
    ];
    const r = backtestSignals(sigs);
    expect(r.trades).toBe(3);
    expect(r.winRate).toBeCloseTo(2 / 3, 6);
    expect(r.avgR).toBeCloseTo((2 + 4 - 1) / 3, 6);
    expect(r.profitFactor).toBeCloseTo(6 / 1, 6);
    expect(r.byTier.strong.trades).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalBacktest.test.ts`
Expected: FAIL — `backtestSignals` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/indicators/signalBacktest.ts
import type { SdSignal } from './signalTypes';

type Tier = SdSignal['tier'];

export interface BacktestSlice {
  trades: number;
  winRate: number;
  avgR: number;
}

export interface BacktestReport {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;   // R per trade (== avgR)
  profitFactor: number;
  maxDrawdownR: number;
  avgBarsInTrade: number;
  byTier: Record<Tier, BacktestSlice>;
  byTf: Record<string, BacktestSlice>;
}

const RESOLVED = new Set<SdSignal['status']>(['tp1', 'tp2', 'stopped']);

/** Realized R for a resolved signal, risk = |entry-stopLoss|. */
function signalR(s: SdSignal): number {
  const risk = Math.abs(s.entry - s.stopLoss);
  if (risk <= 0) return 0;
  const exit = s.status === 'tp2' ? s.takeProfit2 : s.status === 'tp1' ? s.takeProfit1 : s.stopLoss;
  const raw = s.side === 'buy' ? exit - s.entry : s.entry - exit;
  return raw / risk;
}

function slice(rs: number[]): BacktestSlice {
  const trades = rs.length;
  const wins = rs.filter((r) => r > 0).length;
  return { trades, winRate: trades ? wins / trades : 0, avgR: trades ? rs.reduce((s, r) => s + r, 0) / trades : 0 };
}

export function backtestSignals(signals: SdSignal[]): BacktestReport {
  const resolved = signals
    .filter((s) => RESOLVED.has(s.status) && s.triggeredIndex != null && s.resolvedIndex != null)
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

  const rs = resolved.map(signalR);
  const wins = rs.filter((r) => r > 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));

  let peak = 0, equity = 0, maxDd = 0;
  for (const r of rs) { equity += r; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity); }

  const bars = resolved.map((s) => s.resolvedIndex! - s.triggeredIndex!);
  const tiers: Tier[] = ['medium', 'strong'];
  const byTier = Object.fromEntries(
    tiers.map((t) => [t, slice(resolved.filter((s) => s.tier === t).map(signalR))]),
  ) as Record<Tier, BacktestSlice>;
  const tfKeys = [...new Set(resolved.map((s) => s.zoneTf))];
  const byTf = Object.fromEntries(
    tfKeys.map((tf) => [tf, slice(resolved.filter((s) => s.zoneTf === tf).map(signalR))]),
  ) as Record<string, BacktestSlice>;

  const trades = rs.length;
  const avgR = trades ? rs.reduce((s, r) => s + r, 0) / trades : 0;
  return {
    trades, wins, losses: trades - wins,
    winRate: trades ? wins / trades : 0,
    avgR, expectancy: avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownR: maxDd,
    avgBarsInTrade: bars.length ? bars.reduce((s, b) => s + b, 0) / bars.length : 0,
    byTier, byTf,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalBacktest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalBacktest.ts lib/indicators/signalBacktest.test.ts
git commit -m "feat(signals): backtest report (winRate/avgR/PF/DD by tier & tf)"
```

---

# PHASE C — Integration (only after the engine is proven)

### Task 8: Glue — `sdSignals.ts` + register `sd_signals` indicator

**Files:**
- Create: `lib/indicators/sdSignals.ts`
- Test: `lib/indicators/sdSignals.test.ts`
- Modify: `lib/customIndicatorsLibrary.ts`

**Interfaces:**
- Consumes: `buildZones`, `atrSeries` from `./sdZones`; `scoreZone`, `countRetests`, `DEFAULT_ZONE_STRENGTH_WEIGHTS`, `Zone` from `./zoneStrength`; `HtfPeriod` from `./htf`; `generateSignals`, `DEFAULT_SIGNAL_CONFIG`, `SignalEngineConfig`, `SignalContext`, `ConfirmationMode`, `SlBufferMode` from `./signalEngine`; `ScoredZone`, `SdSignal` from `./signalTypes`; `resolveInputs` from `./itsTemplates`; framework types.
- Produces: `buildScoredZones(candles, tfs, targetFactor) => ScoredZone[]`, `computeSdSignalEvents(candles, config?, ctx?) => SdSignal[]`, `computeSdSignals(candles, config?) => IndicatorResult`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/sdSignals.test.ts
import { describe, it, expect } from 'vitest';
import { computeSdSignals, computeSdSignalEvents } from './sdSignals';
import type { Candle } from '../types';

function synth(): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 220; i++) {
    const day = Math.floor(i / 24);
    const drift = day < 3 ? 0.4 : day === 3 && i % 24 < 6 ? -1.2 : 0.8;
    const o = price;
    price = Math.max(1, price + drift);
    const h = Math.max(o, price) + 1;
    const l = Math.min(o, price) - 1;
    bars.push({ time: 1_600_000_000 + i * 3600, open: o, high: h, low: l, close: price, volume: 1000 + (i % 24) * 10 } as Candle);
  }
  return bars;
}

describe('computeSdSignals glue', () => {
  it('returns an IndicatorResult with the framework shape', () => {
    const bars = synth();
    const res = computeSdSignals(bars, { id: 'sd_signals', settings: {} });
    expect(Array.isArray(res.signals)).toBe(true);
    expect(res.signals.length).toBe(bars.length);
    expect(Array.isArray(res.markers)).toBe(true);
  });

  it('emits SdSignal contract objects; triggered ones have concrete levels', () => {
    const events = computeSdSignalEvents(synth(), { id: 'sd_signals', settings: {} }, { symbol: 'BTCUSDT', timeframe: '1h' });
    for (const e of events) {
      expect(['buy', 'sell']).toContain(e.side);
      if (e.triggeredIndex != null) {
        expect(Number.isNaN(e.stopLoss)).toBe(false);
        expect(Number.isNaN(e.takeProfit1)).toBe(false);
        expect(e.confidence).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/sdSignals.test.ts`
Expected: FAIL — module `./sdSignals` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/indicators/sdSignals.ts
import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorMarker, SignalSide } from '../indicatorFramework';
import type { HtfPeriod } from './htf';
import { buildZones, atrSeries } from './sdZones';
import { scoreZone, countRetests, DEFAULT_ZONE_STRENGTH_WEIGHTS, type Zone } from './zoneStrength';
import { resolveInputs } from './itsTemplates';
import {
  generateSignals, DEFAULT_SIGNAL_CONFIG,
  type SignalEngineConfig, type SignalContext, type ConfirmationMode, type SlBufferMode,
} from './signalEngine';
import type { ScoredZone, SdSignal } from './signalTypes';

interface SdSignalsInputs {
  tf1: string; tf2: string; tf3: string; targetFactor: number;
  confirmation: ConfirmationMode; minTier: 'medium' | 'strong';
  confidenceFloor: number; minRR: number;
  slBufferMode: SlBufferMode; slBuffer: number; tickSize: number;
  maxBarsToTrigger: number; maxBarsInTrade: number;
}

const SD_SIGNALS_DEFAULTS: SdSignalsInputs = {
  tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5,
  confirmation: 'rejection_close', minTier: 'medium',
  confidenceFloor: 55, minRR: 1.5,
  slBufferMode: 'atr', slBuffer: 0.25, tickSize: 0.1,
  maxBarsToTrigger: 20, maxBarsInTrade: 150,
};

const avgPeriodVolume = (zones: Zone[]): number => {
  const seen = new Set<number>(); let sum = 0, n = 0;
  for (const z of zones) if (!seen.has(z.formedOHLC.startTime)) { seen.add(z.formedOHLC.startTime); sum += z.formedOHLC.volume; n++; }
  return n ? sum / n : 0;
};

/**
 * Build + score every zone across the configured TFs (all history).
 *
 * PHASE-1 APPROXIMATION (documented in the user-facing indicator description
 * and spec §16): zone strength/confluence is computed against the full set of
 * zones rather than only those that existed at the zone's formation bar. This
 * is faithful enough to validate the signal engine and never repaints (the
 * inputs are fixed once bars close), but it can differ slightly from a strict
 * as-of-formation score.
 * TODO(phase-2): score each zone using only information available at
 * `formedAtIndex` (as-of-formation confluence) for maximally faithful history.
 */
export function buildScoredZones(candles: Candle[], tfs: HtfPeriod[], targetFactor: number): ScoredZone[] {
  if (candles.length === 0) return [];
  const atr = atrSeries(candles, 14);
  const byTf = new Map<HtfPeriod, Zone[]>();
  for (const tf of tfs) byTf.set(tf, buildZones(candles, tf, targetFactor));
  const all = [...byTf.values()].flat();

  return all.map((z) => {
    const zoneType: 'supply' | 'demand' = z.kind === 'supply' || z.kind === 'supplyTarget' ? 'supply' : 'demand';
    const others = all.filter((o) => o !== z && o.tf !== z.tf);
    const isConfluence = others.some((o) => o.kind === z.kind && z.lower <= o.upper && z.upper >= o.lower);
    const strength = z.kind === 'demand' || z.kind === 'supply'
      ? scoreZone(z, candles, others, { avgPeriodVolume: avgPeriodVolume(byTf.get(z.tf) ?? []), atrAtFormation: atr[z.formedAtIndex] ?? 0 }, DEFAULT_ZONE_STRENGTH_WEIGHTS)
      : { score: 0, tier: 'weak' as const, factors: { formationVolume: 0, rejectionStrength: 0, retests: 0, freshness: 0, confluence: 0, zoneWidth: 0 } };
    return {
      kind: z.kind, zoneType, tf: z.tf, upper: z.upper, lower: z.lower, mid: (z.upper + z.lower) / 2,
      formedAtIndex: z.formedAtIndex, formedTime: z.formedOHLC.startTime,
      strength, isConfluence, retestCount: countRetests(z, candles),
    };
  });
}

function toEngineConfig(inp: SdSignalsInputs): SignalEngineConfig {
  return {
    ...DEFAULT_SIGNAL_CONFIG,
    confirmation: inp.confirmation, minTier: inp.minTier,
    confidenceFloor: inp.confidenceFloor, minRR: inp.minRR,
    slBufferMode: inp.slBufferMode, slBuffer: inp.slBuffer, tickSize: inp.tickSize,
    maxBarsToTrigger: inp.maxBarsToTrigger, maxBarsInTrade: inp.maxBarsInTrade,
  };
}

const resolveTfs = (inp: SdSignalsInputs): HtfPeriod[] =>
  [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod => t === '4H' || t === 'D' || t === 'W' || t === 'M');

/** Emission boundary — every consumer (chart, dashboard, backtester, future
 *  alerts) reads SdSignal[] from here. Pure + deterministic. */
export function computeSdSignalEvents(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  ctx: SignalContext = { symbol: '', timeframe: '' },
): SdSignal[] {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const tfs = resolveTfs(inp);
  if (candles.length === 0 || tfs.length === 0) return [];
  const zones = buildScoredZones(candles, tfs, inp.targetFactor);
  const atr = atrSeries(candles, 14);
  return generateSignals(candles, zones, atr, toEngineConfig(inp), ctx);
}

const TRIGGERED = new Set<SdSignal['status']>(['triggered', 'tp1', 'tp2', 'stopped', 'expired']);

export function computeSdSignals(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const events = computeSdSignalEvents(candles, config);
  const markers: IndicatorMarker[] = [];
  const levels: IndicatorLevel[] = [];

  for (const e of events) {
    if (e.triggeredIndex == null || !TRIGGERED.has(e.status)) continue;
    signals[e.triggeredIndex] = e.side;
    markers.push({
      index: e.triggeredIndex,
      position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: e.side === 'buy' ? '#26a69a' : '#f23645',
      shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: `${e.side === 'buy' ? 'BUY' : 'SELL'} ${e.zoneTf} ★${Math.round(e.confidence)} · R${e.riskReward.toFixed(1)}`,
    });
  }

  const active = [...events].reverse().find((e) => e.status === 'triggered' || e.status === 'tp1');
  if (active) {
    levels.push({ value: active.entry, color: '#2A62FF', lineStyle: 'solid', lineWidth: 1, title: `Entry ${active.entry.toFixed(1)}` });
    levels.push({ value: active.stopLoss, color: '#f5a623', lineStyle: 'dashed', lineWidth: 1, title: `SL ${active.stopLoss.toFixed(1)}` });
    levels.push({ value: active.takeProfit1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${active.takeProfit1.toFixed(1)}` });
    levels.push({ value: active.takeProfit2, color: '#22d39a', lineStyle: 'dotted', lineWidth: 1, title: `TP2 ${active.takeProfit2.toFixed(1)}` });
  }

  return { plots: [], signals, markers, levels };
}
```

Register in `lib/customIndicatorsLibrary.ts` — add the import next to the other `./indicators/*` imports:

```ts
import { computeSdSignals } from './indicators/sdSignals';
```

and insert this object immediately after the `sd_zones` entry closes (`compute: computeSdZones,` then `},`). The **user-facing description carries the approximation note**:

```ts
  {
    id: 'sd_signals',
    name: 'Supply / Demand Signals',
    description: 'Non-repainting reversal Buy/Sell signals at S/D zones — configurable stop-loss, TP1 (opposing zone) / TP2 (measured move), and an explained confidence score. Note: historical zone strength is scored against the full zone set (not strictly as-of-formation) — a Phase-1 approximation. Paper & educational — not financial advice.',
    inputs: [
      { id: 'tf1', name: 'Zone Timeframe 1', type: 'select', default: 'D', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf2', name: 'Zone Timeframe 2', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf3', name: 'Zone Timeframe 3', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'targetFactor', name: 'Target projection ×', type: 'number', default: 1.5, min: 0, max: 5, step: 0.1 },
      { id: 'confirmation', name: 'Confirmation', type: 'select', default: 'rejection_close', options: ['touch','rejection_close','reversal_candle'].map((v) => ({ value: v, label: v })) },
      { id: 'minTier', name: 'Min zone tier', type: 'select', default: 'medium', options: ['medium','strong'].map((v) => ({ value: v, label: v })) },
      { id: 'confidenceFloor', name: 'Min confidence', type: 'number', default: 55, min: 0, max: 100, step: 1 },
      { id: 'minRR', name: 'Min R:R', type: 'number', default: 1.5, min: 0, max: 10, step: 0.1 },
      { id: 'slBufferMode', name: 'Stop buffer mode', type: 'select', default: 'atr', options: ['atr','percent','ticks'].map((v) => ({ value: v, label: v })) },
      { id: 'slBuffer', name: 'Stop buffer', type: 'number', default: 0.25, min: 0, max: 100, step: 0.05 },
      { id: 'tickSize', name: 'Tick size', type: 'number', default: 0.1, min: 0.00000001, max: 1000, step: 0.1 },
      { id: 'maxBarsToTrigger', name: 'Max bars to trigger', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'maxBarsInTrade', name: 'Max bars in trade', type: 'number', default: 150, min: 1, max: 5000, step: 1 },
    ],
    styles: [],
    compute: computeSdSignals,
  },
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `npx vitest run lib/indicators/sdSignals.test.ts && npx tsc --noEmit && npx eslint lib/indicators/sdSignals.ts lib/customIndicatorsLibrary.ts`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/sdSignals.ts lib/indicators/sdSignals.test.ts lib/customIndicatorsLibrary.ts
git commit -m "feat(signals): sd_signals glue + indicator registration (+approximation note)"
```

---

### Task 9: Signals panel (list + explanation)

**Files:**
- Create: `components/trade/SignalsPanel.tsx`
- Test: `components/trade/SignalsPanel.test.tsx`

**Interfaces:**
- Consumes: `SdSignal` from `@/lib/indicators/signalTypes`; `Panel` from `@/components/ui`.
- Produces: `SignalsPanel({ signals }: { signals: SdSignal[] })` default export.

**Note:** confirm `Panel`'s import + `title` prop (`grep -n "export function Panel\|export const Panel\|PanelProps" components/ui/*.tsx`) and adjust if needed. Prefer `Num.*` for values (B5-FREEZE); this lives in `components/**` where the lint rule is advisory, so `.toFixed` is tolerated if a `Num` variant is missing.

- [ ] **Step 1: Write the failing test**

```tsx
// components/trade/SignalsPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SignalsPanel from './SignalsPanel';
import type { SdSignal } from '@/lib/indicators/signalTypes';

const sig: SdSignal = {
  id: 'buy:D:demand:0', side: 'buy', timeframe: '1h', symbol: 'BTCUSDT',
  zoneId: 'D:demand:0', zoneTf: 'D', zoneKind: 'demand', status: 'triggered',
  entry: 108, stopLoss: 99, takeProfit1: 130, takeProfit2: 140, riskReward: 2.4, confidence: 82,
  explanation: { factors: [{ key: 'zoneStrength', label: 'Zone strength', input: 0.9, weight: 0.35, contribution: 31.5 }], summary: 'Strong demand zone, 2.4R', counterSignals: ['retested 3×'] },
  tier: 'strong', armedIndex: 2, triggeredIndex: 3, resolvedIndex: null, createdAt: 1_600_000_000, resolvedAt: null,
};

describe('SignalsPanel', () => {
  it('renders a signal row with side and confidence', () => {
    render(<SignalsPanel signals={[sig]} />);
    expect(screen.getByText(/BUY/)).toBeTruthy();
    expect(screen.getByText(/82/)).toBeTruthy();
  });
  it('expands to show explanation factors and counter-signals', () => {
    render(<SignalsPanel signals={[sig]} />);
    fireEvent.click(screen.getByRole('button', { name: /buy:D:demand:0/i }));
    expect(screen.getByText(/Zone strength/)).toBeTruthy();
    expect(screen.getByText(/retested 3×/)).toBeTruthy();
  });
  it('shows the empty state when there are no signals', () => {
    render(<SignalsPanel signals={[]} />);
    expect(screen.getByText(/No signals/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/trade/SignalsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/trade/SignalsPanel.tsx
'use client';

import { useState } from 'react';
import { Panel } from '@/components/ui';
import type { SdSignal } from '@/lib/indicators/signalTypes';

const band = (c: number): string => (c >= 80 ? 'High' : c >= 65 ? 'Medium' : 'Low');
const statusLabel: Record<SdSignal['status'], string> = {
  armed: 'Armed', triggered: 'Live', tp1: 'TP1', tp2: 'TP2',
  stopped: 'Stopped', invalidated: 'Void', expired: 'Expired',
};

export default function SignalsPanel({ signals }: { signals: SdSignal[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = signals.filter((s) => s.triggeredIndex != null).slice().reverse();

  return (
    <Panel title="Signals">
      <p className="mb-2 text-[10px] text-ink-faint">Paper &amp; educational — not financial advice.</p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-muted">No signals yet.</p>
      ) : (
        <ul className="divide-y divide-line text-xs">
          {rows.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={s.id}
                onClick={() => setOpen(open === s.id ? null : s.id)}
                className="focus-ring flex w-full items-center justify-between gap-2 py-2 text-left"
              >
                <span className={s.side === 'buy' ? 'font-semibold text-bull-bright' : 'font-semibold text-bear-bright'}>
                  {s.side === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span className="font-mono tabular-nums text-ink">{s.entry.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink-muted">R{s.riskReward.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink">{Math.round(s.confidence)} · {band(s.confidence)}</span>
                <span className="text-ink-faint">{statusLabel[s.status]}</span>
              </button>
              {open === s.id && (
                <div className="pb-2 pl-1 text-[11px] text-ink-muted">
                  <p className="mb-1 text-ink">{s.explanation.summary}</p>
                  <div className="grid grid-cols-2 gap-x-3">
                    <span>Entry {s.entry.toFixed(1)} · SL {s.stopLoss.toFixed(1)}</span>
                    <span>TP1 {s.takeProfit1.toFixed(1)} · TP2 {s.takeProfit2.toFixed(1)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {s.explanation.factors.map((f) => (
                      <li key={f.key} className="flex items-center justify-between">
                        <span>{f.label}</span>
                        <span className="font-mono tabular-nums">+{f.contribution.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                  {s.explanation.counterSignals.length > 0 && (
                    <p className="mt-1 text-amber-400">⚠ {s.explanation.counterSignals.join(' · ')}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/trade/SignalsPanel.test.tsx`
Expected: PASS (3 tests). If `Panel` import/props differ, adjust to match and re-run.

- [ ] **Step 5: Commit**

```bash
git add components/trade/SignalsPanel.tsx components/trade/SignalsPanel.test.tsx
git commit -m "feat(signals): SignalsPanel with expandable explanation"
```

---

### Task 10: Dashboard wiring, emission seam, manual verification

**Files:**
- Modify: the chart-side panel host that has `candles` + `symbol` in scope (find it).

**Interfaces:**
- Consumes: `SignalsPanel` (Task 9), `computeSdSignalEvents` (Task 8).

- [ ] **Step 1: Locate the mount point and candle/symbol source**

Run: `grep -rn "candles" components/ChartPanel.tsx | head` and `grep -rn "TradingPanel\|SignalsPanel\|<.*Panel" components/ChartPanel.tsx | head`
Identify the component (likely `components/ChartPanel.tsx`) where `candles`, `symbol`, and the current chart timeframe (`tf`/`interval`) are available.

- [ ] **Step 2: If editing an app/ route, read Next.js docs first** (per AGENTS.md), from `node_modules/next/dist/docs/`.

- [ ] **Step 3: Wire the panel (this is also the event-emission seam)**

In the identified component body:

```tsx
import { useMemo } from 'react';
import SignalsPanel from './trade/SignalsPanel'; // adjust relative path
import { computeSdSignalEvents } from '@/lib/indicators/sdSignals';

// `tf`/`interval` is the chart timeframe string already in scope; pass the real ctx.
const signalEvents = useMemo(
  () => computeSdSignalEvents(candles, { id: 'sd_signals', settings: {} }, { symbol, timeframe: tf }),
  [candles, symbol, tf],
);
```

Render `<SignalsPanel signals={signalEvents} />` alongside the other side panels, matching their wrapper/spacing.

**Emission seam (documented for Phase 2 — do NOT build now):** `signalEvents` recomputes on every closed bar (candles change). A future alerts/webhook layer subscribes here by diffing newly-`triggered` signals (compare `id`s vs the previous render) and dispatching them — no engine change needed. Leave this as a code comment above the `useMemo`:

```tsx
// Emission boundary: on each closed bar this yields the current SdSignal[].
// Phase 2 alerts/webhooks subscribe by diffing newly-`triggered` ids here.
```

- [ ] **Step 4: Verify build + full suite**

Run: `npx tsc --noEmit && npx eslint components/ChartPanel.tsx && npx vitest run`
Expected: clean + full suite green.

- [ ] **Step 5: Manual verification**

`npm run dev`, open the app, add the **Supply / Demand Signals** indicator, and confirm:
- Buy/Sell arrows at zone rejections; entry/SL/TP lines for the active signal.
- Signals panel lists events; expanding a row shows factors + counter-signals + the disclaimer.
- Refresh does not change past triggered signals (non-repaint).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(signals): surface SignalsPanel + sd_signals overlay + emission seam"
```

---

## Self-Review

**1. Spec coverage** — §4 architecture → Tasks 1–10; §5 data model (now the centralized `SdSignal` contract) → Task 1; §6 lifecycle + non-repaint → Tasks 5 & 6; §7 configurable SL + TP1/TP2 → Tasks 2,3,5; §8 confidence + explanation → Task 4; §9 config inputs → Tasks 2 & 8; §10 backtest → Task 7; §11 markers/overlay/panel/disclaimer → Tasks 8,9,10; §16 locked decisions honored; §12 subscription gate deferred. ✓

**2. Placeholder scan** — no TBD/TODO left as work items (the single `TODO(phase-2)` is an intentional, documented future-refinement marker, not a plan gap); every code step is complete; commands have expected output. ✓

**3. Type consistency** — one `SdSignal`/`SignalFactor`/`SignalExplanation`/`ScoredZone` defined in `signalTypes.ts` (Task 1) and imported everywhere; `SignalEngineConfig`/`DEFAULT_SIGNAL_CONFIG` defined once (Task 2); field names `stopLoss`/`takeProfit1`/`takeProfit2`/`status`/`riskReward` used consistently in engine (Task 5), backtest (Task 7), glue (Task 8), and panel (Task 9); `generateSignals(candles, zones, atr, cfg, ctx)` signature matches its call in the glue. ✓

**Enhancements from SDSignal.md** — (1) Phase A/B/C ordering ✓; (2) centralized `SdSignal` contract defined first ✓; (3) event-driven emission boundary documented with a Phase-2 alert seam ✓; (4) historical-confluence approximation documented in code + user-facing indicator description + spec, with a `TODO(phase-2)` ✓.
