# Supply/Demand Trade Signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit non-repainting reversal Buy/Sell signals from the existing Supply/Demand zones, each with a configurable stop-loss, TP1/TP2 targets, a 0–100 confidence score with structured explanation, plus a backtest report and a Signals panel.

**Architecture:** Two pure engines with no framework/chart/store imports — `signalEngine.ts` (decides when a signal fires and its levels/confidence) and `signalBacktest.ts` (aggregates resolved events into metrics). A thin glue file `sdSignals.ts` adapts them to the chart `IndicatorResult` (fills `signals[]` + `markers[]` + `levels[]`) and is registered as a separate `sd_signals` indicator. UI reads the pure event list.

**Tech Stack:** TypeScript, Next.js (custom build — read `node_modules/next/dist/docs/` before any page code), vitest + happy-dom, lightweight-charts v5, Tailwind (MDS tokens).

## Global Constraints

- **Non-repainting:** all state transitions evaluated on CLOSED bars only; a `triggered` event's entry/sl/tp1/tp2 never change afterward. (verbatim spec §6)
- **Pure engines:** `signalEngine.ts` and `signalBacktest.ts` import ONLY from `../types` and `./zoneStrength`/`./htf` types — NO imports from `indicatorFramework`, chart, or any store (mirrors `zoneStrength.ts`).
- **Reversal-only** archetype; **signals fire on the chart timeframe**; **TP1 = nearest opposing zone, TP2 = measured-move target band**; **`sd_signals` is a separate indicator** from `sd_zones`. (spec §16 locked)
- **Defaults (verbatim):** `confirmation=rejection_close`, `minTier=medium`, `confidenceFloor=55`, `minRR=1.5`, `slBufferMode=atr`, `slBuffer=0.25`, `tickSize=0.1`, `maxBarsToTrigger=20`, `maxBarsInTrade=150`; confidence weights `zoneStrength=0.35, confluence=0.20, riskReward=0.20, freshness=0.15, formationVolume=0.10`.
- **Quality gate:** emit as `triggered` only if `tier≥minTier` AND `confidence≥confidenceFloor` AND `rr1≥minRR`; else `invalidated`.
- **Verification per task:** `npx tsc --noEmit` clean, `npx eslint <files>` clean, task tests green. Commit after each task. Branch: `feat/sd-signals` (already checked out).
- **UI freezes:** financial values via `Num.*` (B5-FREEZE), panels via `Panel` (C-FREEZE); persistent "paper & educational — not financial advice" disclaimer wherever signals show.

---

## File Structure

- `lib/indicators/signalEngine.ts` — types + config + `computeStopLoss`, `computeTargets`, `computeConfidence`, `generateSignals`.
- `lib/indicators/signalEngine.test.ts` — unit tests.
- `lib/indicators/signalEngine.golden.test.ts` + `lib/testing/fixtures/signalEngine.golden.json` — determinism + non-repaint.
- `lib/indicators/signalBacktest.ts` — `backtestSignals` + `BacktestReport`.
- `lib/indicators/signalBacktest.test.ts` — unit tests.
- `lib/indicators/sdSignals.ts` — `buildScoredZones`, `computeSdSignalEvents`, `computeSdSignals` (glue).
- `lib/indicators/sdSignals.test.ts` — glue tests.
- `lib/customIndicatorsLibrary.ts` — register `sd_signals` (modify).
- `components/trade/SignalsPanel.tsx` — signals list + expandable explanation.
- `components/trade/SignalsPanel.test.tsx` — render test.
- Dashboard wiring (Task 9).

---

### Task 1: Engine types, config, and configurable stop-loss

**Files:**
- Create: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `Candle` from `../types`; `Zone`, `ZoneKind`, `ZoneStrength` from `./zoneStrength`; `HtfPeriod` from `./htf`.
- Produces: `SlBufferMode`, `ConfirmationMode`, `SignalEngineConfig`, `DEFAULT_SIGNAL_CONFIG`, `ScoredZone`, `computeStopLoss(side, zone, entry, atr, cfg)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalEngine.test.ts
import { describe, it, expect } from 'vitest';
import { computeStopLoss, DEFAULT_SIGNAL_CONFIG } from './signalEngine';

const zone = { upper: 105, lower: 100 };

describe('computeStopLoss', () => {
  it('atr mode: buy stop is zone.lower minus slBuffer*atr', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(99, 6); // 100 - 0.25*4
  });
  it('percent mode: buy stop uses % of entry', () => {
    const sl = computeStopLoss('buy', zone, 200, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'percent', slBuffer: 1 });
    expect(sl).toBeCloseTo(98, 6); // 100 - (1/100)*200
  });
  it('ticks mode: buy stop uses slBuffer*tickSize', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'ticks', slBuffer: 5, tickSize: 0.1 });
    expect(sl).toBeCloseTo(99.5, 6); // 100 - 5*0.1
  });
  it('sell mirrors above the zone upper', () => {
    const sl = computeStopLoss('sell', zone, 104, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(106, 6); // 105 + 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `computeStopLoss` / `DEFAULT_SIGNAL_CONFIG` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/indicators/signalEngine.ts
import type { Candle } from '../types';
import type { ZoneKind, ZoneStrength } from './zoneStrength';
import type { HtfPeriod } from './htf';

export type Side = 'buy' | 'sell';
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

/** A zone annotated with its score + context, consumed by the signal engine. */
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

export const _internal = { Candle: null as unknown as Candle }; // keep Candle import used until Task 4
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

### Task 2: TP1/TP2 target computation

**Files:**
- Modify: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `ScoredZone`, `Side` (Task 1).
- Produces: `computeTargets(side, entry, sl, zones, triggeredIndex, minRR) => { tp1: number; tp2: number }`.

- [ ] **Step 1: Write the failing test** (append to `signalEngine.test.ts`)

```ts
import { computeTargets } from './signalEngine';
import type { ScoredZone } from './signalEngine';

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
    expect(tp1).toBeCloseTo(103, 6); // 100 + 1.5*(100-98)
    expect(tp2).toBeCloseTo(106, 6); // 100 + 2*(103-100)
  });
  it('ignores zones formed after the trigger (no lookahead)', () => {
    const zones = [z({ kind: 'supply', lower: 120, upper: 125, formedAtIndex: 99 })];
    const { tp1 } = computeTargets('buy', 100, 98, zones, 5, 1.5);
    expect(tp1).toBeCloseTo(103, 6); // future supply ignored -> fallback
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

- [ ] **Step 3: Write minimal implementation** (append to `signalEngine.ts`)

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
  const active = zones.filter((z) => z.formedAtIndex <= triggeredIndex);
  if (side === 'buy') {
    const supplies = active
      .filter((z) => z.kind === 'supply' && z.lower > entry)
      .map((z) => z.lower)
      .sort((a, b) => a - b);
    const tp1 = supplies.length ? supplies[0] : entry + minRR * risk;
    const targets = active
      .filter((z) => z.kind === 'supplyTarget' && z.upper > tp1)
      .map((z) => z.upper)
      .sort((a, b) => a - b);
    let tp2 = targets.length ? targets[0] : entry + 2 * (tp1 - entry);
    if (tp2 <= tp1) tp2 = tp1 + (tp1 - entry);
    return { tp1, tp2 };
  }
  const demands = active
    .filter((z) => z.kind === 'demand' && z.upper < entry)
    .map((z) => z.upper)
    .sort((a, b) => b - a);
  const tp1 = demands.length ? demands[0] : entry - minRR * risk;
  const targets = active
    .filter((z) => z.kind === 'demandTarget' && z.lower < tp1)
    .map((z) => z.lower)
    .sort((a, b) => b - a);
  let tp2 = targets.length ? targets[0] : entry - 2 * (entry - tp1);
  if (tp2 >= tp1) tp2 = tp1 - (entry - tp1);
  return { tp1, tp2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: PASS (all target tests + Task 1 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): TP1 opposing-zone + TP2 measured-move targets"
```

---

### Task 3: Confidence score + structured explanation

**Files:**
- Modify: `lib/indicators/signalEngine.ts`
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `ScoredZone` (Task 1).
- Produces: `SignalFactor`, `SignalExplanation`, `computeConfidence(zone, rr1, minRR, cfg) => { confidence: number; explanation: SignalExplanation }`.

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
    expect(explanation.counterSignals).toContain('stale zone'); // freshness 0.2 < 0.3
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

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export interface SignalFactor {
  key: 'zoneStrength' | 'confluence' | 'riskReward' | 'freshness' | 'formationVolume';
  label: string;
  input: number;       // normalized 0..1
  weight: number;
  contribution: number; // weight * input * 100
}

export interface SignalExplanation {
  factors: SignalFactor[];
  summary: string;
  counterSignals: string[];
}

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

### Task 4: `generateSignals` state machine + resolution

**Files:**
- Modify: `lib/indicators/signalEngine.ts` (remove the `_internal` shim from Task 1)
- Test: `lib/indicators/signalEngine.test.ts`

**Interfaces:**
- Consumes: `Candle`, `ScoredZone`, `computeStopLoss`, `computeTargets`, `computeConfidence` (Tasks 1–3).
- Produces: `SignalState`, `SignalEvent`, `generateSignals(candles, zones, atr, cfg) => SignalEvent[]`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { generateSignals } from './signalEngine';
import type { Candle } from '../types';

// candle helper (time in seconds, ascending)
const c = (i: number, o: number, h: number, l: number, cl: number): Candle =>
  ({ time: 1000 + i * 60, open: o, high: h, low: l, close: cl, volume: 100 } as Candle);

// A demand zone at 100-105; price dips into it at bar 2, then closes back above at bar 3.
const demand = z({
  kind: 'demand', zoneType: 'demand', lower: 100, upper: 105, mid: 102.5,
  formedAtIndex: 0, strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
});
const supply = z({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135, formedAtIndex: 0 });

const bars: Candle[] = [
  c(0, 110, 112, 108, 111),
  c(1, 111, 112, 106, 107),
  c(2, 107, 108, 101, 103),   // enters demand (low 101 <= 105) -> armed
  c(3, 103, 109, 102, 108),   // close 108 > 105 -> rejection confirm -> triggered
  c(4, 108, 122, 107, 120),
  c(5, 120, 131, 119, 130),   // high 131 >= supply.lower 130 -> hit_tp1
];
const atr = bars.map(() => 4);

describe('generateSignals (buy lifecycle)', () => {
  it('arms on zone touch, triggers on rejection close, resolves at TP1', () => {
    const events = generateSignals(bars, [demand, supply], atr, { ...CFG });
    const ev = events.find((e) => e.side === 'buy');
    expect(ev).toBeTruthy();
    expect(ev!.armedIndex).toBe(2);
    expect(ev!.triggeredIndex).toBe(3);
    expect(ev!.entry).toBeCloseTo(108, 6);
    expect(ev!.sl).toBeCloseTo(99, 6);   // 100 - 0.25*4
    expect(ev!.tp1).toBe(130);           // supply.lower
    expect(ev!.state).toBe('hit_tp1');
  });

  it('discards a setup whose R:R is below minRR (invalidated, not triggered)', () => {
    const events = generateSignals(bars, [demand, supply], atr, { ...CFG, minRR: 100 });
    const ev = events.find((e) => e.side === 'buy');
    expect(ev!.state).toBe('invalidated');
    expect(ev!.triggeredIndex).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: FAIL — `generateSignals` not exported.

- [ ] **Step 3: Write minimal implementation**

First delete the `_internal` shim line from Task 1 (Candle is now used). Then append:

```ts
export type SignalState =
  | 'armed' | 'triggered' | 'hit_tp1' | 'hit_tp2'
  | 'stopped' | 'invalidated' | 'expired';

export interface SignalEvent {
  id: string;
  side: Side;
  zoneTf: HtfPeriod;
  zoneKind: 'supply' | 'demand';
  zoneUpper: number;
  zoneLower: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr1: number;
  confidence: number;
  explanation: SignalExplanation;
  tier: 'medium' | 'strong';
  state: SignalState;
  armedIndex: number | null;
  triggeredIndex: number | null;
  resolvedIndex: number | null;
  armedTime: number | null;
  triggeredTime: number | null;
  resolvedTime: number | null;
}

const TIER_RANK: Record<ZoneStrength['tier'], number> = { weak: 0, medium: 1, strong: 2 };
const inZone = (z: { upper: number; lower: number }, bar: Candle): boolean =>
  bar.low <= z.upper && bar.high >= z.lower;

function isConfirmed(side: Side, zone: ScoredZone, bar: Candle, mode: ConfirmationMode): boolean {
  if (mode === 'touch') return true;
  const rejected = side === 'buy' ? bar.close > zone.upper : bar.close < zone.lower;
  if (mode === 'rejection_close') return rejected;
  const directional = side === 'buy' ? bar.close > bar.open : bar.close < bar.open; // reversal_candle
  return rejected && directional;
}

/** Pure, non-repainting. One event per zone that at least armed. */
export function generateSignals(
  candles: Candle[],
  zones: ScoredZone[],
  atr: Array<number | null>,
  cfg: SignalEngineConfig,
): SignalEvent[] {
  const events: SignalEvent[] = [];
  const entryZones = zones.filter(
    (z) => (z.kind === 'demand' || z.kind === 'supply') && TIER_RANK[z.strength.tier] >= TIER_RANK[cfg.minTier],
  );

  for (const zone of entryZones) {
    const side: Side = zone.kind === 'demand' ? 'buy' : 'sell';
    // 1. Arm: first bar after formation that enters the zone.
    let armedIndex = -1;
    for (let i = zone.formedAtIndex + 1; i < candles.length; i++) {
      if (inZone(zone, candles[i])) { armedIndex = i; break; }
    }
    if (armedIndex === -1) continue;

    const base: SignalEvent = {
      id: `${side}:${zone.tf}:${zone.kind}:${zone.formedAtIndex}`,
      side, zoneTf: zone.tf, zoneKind: zone.kind === 'demand' ? 'demand' : 'supply',
      zoneUpper: zone.upper, zoneLower: zone.lower,
      entry: NaN, sl: NaN, tp1: NaN, tp2: NaN, rr1: NaN,
      confidence: 0, explanation: { factors: [], summary: '', counterSignals: [] },
      tier: zone.strength.tier === 'strong' ? 'strong' : 'medium',
      state: 'armed',
      armedIndex, triggeredIndex: null, resolvedIndex: null,
      armedTime: candles[armedIndex].time, triggeredTime: null, resolvedTime: null,
    };

    // 2. Confirm within maxBarsToTrigger; a close beyond the far edge invalidates.
    let triggeredIndex = -1;
    for (let j = armedIndex; j < candles.length && j - armedIndex <= cfg.maxBarsToTrigger; j++) {
      const bar = candles[j];
      const broken = side === 'buy' ? bar.close < zone.lower : bar.close > zone.upper;
      if (broken) { events.push({ ...base, state: 'invalidated' }); triggeredIndex = -2; break; }
      if (isConfirmed(side, zone, bar, cfg.confirmation)) { triggeredIndex = j; break; }
    }
    if (triggeredIndex === -2) continue;
    if (triggeredIndex === -1) { events.push({ ...base, state: 'expired' }); continue; }

    // 3. Levels + quality gate (entry now known).
    const entry = candles[triggeredIndex].close;
    const sl = computeStopLoss(side, zone, entry, atr[triggeredIndex] ?? 0, cfg);
    const { tp1, tp2 } = computeTargets(side, entry, sl, zones, triggeredIndex, cfg.minRR);
    const risk = Math.abs(entry - sl);
    const rr1 = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
    const { confidence, explanation } = computeConfidence(zone, rr1, cfg.minRR, cfg);

    const gated = { ...base, entry, sl, tp1, tp2, rr1, confidence, explanation };
    if (confidence < cfg.confidenceFloor || rr1 < cfg.minRR) {
      events.push({ ...gated, state: 'invalidated' });
      continue;
    }

    // 4. Resolve forward within maxBarsInTrade (SL first = conservative).
    let state: SignalState = 'triggered';
    let resolvedIndex: number | null = null;
    let hitTp1 = false;
    for (let k = triggeredIndex + 1; k < candles.length && k - triggeredIndex <= cfg.maxBarsInTrade; k++) {
      const bar = candles[k];
      const slHit = side === 'buy' ? bar.low <= sl : bar.high >= sl;
      const tp1Hit = side === 'buy' ? bar.high >= tp1 : bar.low <= tp1;
      const tp2Hit = side === 'buy' ? bar.high >= tp2 : bar.low <= tp2;
      if (slHit) { state = 'stopped'; resolvedIndex = k; break; }
      if (tp2Hit && hitTp1) { state = 'hit_tp2'; resolvedIndex = k; break; }
      if (tp1Hit) { hitTp1 = true; state = 'hit_tp1'; resolvedIndex = k; }
    }
    if (state === 'triggered' || (state === 'hit_tp1' && resolvedIndex === null)) {
      // triggered but never resolved within window
      state = 'expired';
    }

    events.push({
      ...gated,
      state,
      triggeredIndex,
      triggeredTime: candles[triggeredIndex].time,
      resolvedIndex,
      resolvedTime: resolvedIndex != null ? candles[resolvedIndex].time : null,
    });
  }

  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.test.ts`
Expected: PASS (buy lifecycle + invalidated). Also run `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.ts lib/indicators/signalEngine.test.ts
git commit -m "feat(signals): generateSignals lifecycle + resolution"
```

---

### Task 5: Golden-master (determinism + non-repaint)

**Files:**
- Create: `lib/indicators/signalEngine.golden.test.ts`
- Create: `lib/testing/fixtures/signalEngine.golden.json` (generated in Step 3)

**Interfaces:**
- Consumes: `generateSignals`, `ScoredZone`, `DEFAULT_SIGNAL_CONFIG`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalEngine.golden.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSignals, DEFAULT_SIGNAL_CONFIG } from './signalEngine';
import type { ScoredZone } from './signalEngine';
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

const GOLDEN = join(__dirname, '..', 'testing', 'fixtures', 'signalEngine.golden.json');

describe('signalEngine golden', () => {
  it('matches the frozen event snapshot', () => {
    const events = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG);
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(events).toEqual(expected);
  });

  it('does not repaint: a triggered event is identical when computed over a prefix', () => {
    const full = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG).find((e) => e.triggeredIndex === 3)!;
    const prefix = generateSignals(bars.slice(0, 5), zones, atr.slice(0, 5), DEFAULT_SIGNAL_CONFIG).find((e) => e.triggeredIndex === 3)!;
    expect(prefix.entry).toBe(full.entry);
    expect(prefix.sl).toBe(full.sl);
    expect(prefix.tp1).toBe(full.tp1);
    expect(prefix.tp2).toBe(full.tp2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/indicators/signalEngine.golden.test.ts`
Expected: FAIL — fixture file missing (ENOENT).

- [ ] **Step 3: Generate the fixture, then verify by inspection**

Run this one-off to write the golden file, then open it and sanity-check the triggered buy event has `entry:108, sl:99, tp1:130, state:"hit_tp1"`:

```bash
npx tsx -e "import{generateSignals,DEFAULT_SIGNAL_CONFIG}from'./lib/indicators/signalEngine';import{writeFileSync}from'node:fs';const c=(i,o,h,l,cl)=>({time:1000+i*60,open:o,high:h,low:l,close:cl,volume:100});const s={kind:'demand',zoneType:'demand',tf:'D',upper:105,lower:100,mid:102.5,formedAtIndex:0,formedTime:1000,isConfluence:false,retestCount:0,strength:{score:80,tier:'strong',factors:{formationVolume:0.7,rejectionStrength:0.7,retests:0,freshness:0.9,confluence:0,zoneWidth:0.5}}};const zones=[s,{...s,kind:'supply',zoneType:'supply',lower:130,upper:135}];const bars=[c(0,110,112,108,111),c(1,111,112,106,107),c(2,107,108,101,103),c(3,103,109,102,108),c(4,108,122,107,120),c(5,120,131,119,130)];const atr=bars.map(()=>4);writeFileSync('lib/testing/fixtures/signalEngine.golden.json',JSON.stringify(generateSignals(bars,zones,atr,DEFAULT_SIGNAL_CONFIG),null,2)+'\n');console.log('written');"
```

(If `tsx` is unavailable, use `npx vitest` with a temporary `console.log(JSON.stringify(events,null,2))` in Step 1's snapshot test, copy the output into the fixture, then remove the log.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/indicators/signalEngine.golden.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/signalEngine.golden.test.ts lib/testing/fixtures/signalEngine.golden.json
git commit -m "test(signals): golden-master + non-repaint lock"
```

---

### Task 6: Backtest report

**Files:**
- Create: `lib/indicators/signalBacktest.ts`
- Test: `lib/indicators/signalBacktest.test.ts`

**Interfaces:**
- Consumes: `SignalEvent` (Task 4).
- Produces: `BacktestReport`, `backtestSignals(events) => BacktestReport`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/signalBacktest.test.ts
import { describe, it, expect } from 'vitest';
import { backtestSignals } from './signalBacktest';
import type { SignalEvent } from './signalEngine';

const base: SignalEvent = {
  id: 'x', side: 'buy', zoneTf: 'D', zoneKind: 'demand', zoneUpper: 105, zoneLower: 100,
  entry: 100, sl: 90, tp1: 120, tp2: 140, rr1: 2, confidence: 70,
  explanation: { factors: [], summary: '', counterSignals: [] }, tier: 'strong',
  state: 'hit_tp1', armedIndex: 1, triggeredIndex: 2, resolvedIndex: 5,
  armedTime: 0, triggeredTime: 0, resolvedTime: 0,
};

describe('backtestSignals', () => {
  it('computes win rate, avgR and profit factor over resolved events', () => {
    const events: SignalEvent[] = [
      { ...base, state: 'hit_tp1', tp1: 120, entry: 100, sl: 90 },  // +2R
      { ...base, state: 'hit_tp2', tp2: 140, tp1: 120, entry: 100, sl: 90 }, // +4R
      { ...base, state: 'stopped', entry: 100, sl: 90 },            // -1R
      { ...base, state: 'expired' },                                 // excluded
    ];
    const r = backtestSignals(events);
    expect(r.trades).toBe(3);
    expect(r.winRate).toBeCloseTo(2 / 3, 6);
    expect(r.avgR).toBeCloseTo((2 + 4 - 1) / 3, 6);
    expect(r.profitFactor).toBeCloseTo((2 + 4) / 1, 6);
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
import type { SignalEvent, ScoredZone } from './signalEngine';

type Tier = ScoredZone['strength']['tier'];

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
  expectancy: number;   // same as avgR (R per trade)
  profitFactor: number;
  maxDrawdownR: number;
  avgBarsInTrade: number;
  byTier: Record<Tier, BacktestSlice>;
  byTf: Record<string, BacktestSlice>;
}

const RESOLVED = new Set<SignalEvent['state']>(['hit_tp1', 'hit_tp2', 'stopped']);

/** Realized R for a resolved event (buy or sell), risk = |entry-sl|. */
function eventR(e: SignalEvent): number {
  const risk = Math.abs(e.entry - e.sl);
  if (risk <= 0) return 0;
  const exit = e.state === 'hit_tp2' ? e.tp2 : e.state === 'hit_tp1' ? e.tp1 : e.sl;
  const raw = e.side === 'buy' ? exit - e.entry : e.entry - exit;
  return raw / risk;
}

function slice(rs: number[]): BacktestSlice {
  const trades = rs.length;
  const wins = rs.filter((r) => r > 0).length;
  return {
    trades,
    winRate: trades ? wins / trades : 0,
    avgR: trades ? rs.reduce((s, r) => s + r, 0) / trades : 0,
  };
}

export function backtestSignals(events: SignalEvent[]): BacktestReport {
  const resolved = events
    .filter((e) => RESOLVED.has(e.state) && e.triggeredIndex != null && e.resolvedIndex != null)
    .sort((a, b) => (a.resolvedTime ?? 0) - (b.resolvedTime ?? 0));

  const rs = resolved.map(eventR);
  const wins = rs.filter((r) => r > 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));

  // Max drawdown on the cumulative-R equity curve.
  let peak = 0, equity = 0, maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const bars = resolved.map((e) => (e.resolvedIndex! - e.triggeredIndex!));
  const tiers: Tier[] = ['weak', 'medium', 'strong'];
  const byTier = Object.fromEntries(
    tiers.map((t) => [t, slice(resolved.filter((e) => e.tier === t).map(eventR))]),
  ) as Record<Tier, BacktestSlice>;
  const tfKeys = [...new Set(resolved.map((e) => e.zoneTf))];
  const byTf = Object.fromEntries(
    tfKeys.map((tf) => [tf, slice(resolved.filter((e) => e.zoneTf === tf).map(eventR))]),
  ) as Record<string, BacktestSlice>;

  const trades = rs.length;
  const avgR = trades ? rs.reduce((s, r) => s + r, 0) / trades : 0;
  return {
    trades,
    wins,
    losses: trades - wins,
    winRate: trades ? wins / trades : 0,
    avgR,
    expectancy: avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownR: maxDd,
    avgBarsInTrade: bars.length ? bars.reduce((s, b) => s + b, 0) / bars.length : 0,
    byTier,
    byTf,
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

### Task 7: Glue — `sdSignals.ts` + register `sd_signals` indicator

**Files:**
- Create: `lib/indicators/sdSignals.ts`
- Test: `lib/indicators/sdSignals.test.ts`
- Modify: `lib/customIndicatorsLibrary.ts` (add `import { computeSdSignals } from './indicators/sdSignals';` near the other indicator imports, and add the registration object after the `sd_zones` entry ends at `compute: computeSdZones },`)

**Interfaces:**
- Consumes: `buildZones`, `atrSeries` from `./sdZones`; `scoreZone`, `countRetests`, `DEFAULT_ZONE_STRENGTH_WEIGHTS` from `./zoneStrength`; `priorPeriodOHLC`/`HtfPeriod` from `./htf`; `generateSignals`, `ScoredZone`, `SignalEvent`, `DEFAULT_SIGNAL_CONFIG` from `./signalEngine`; `resolveInputs` from `./itsTemplates`; framework types.
- Produces: `buildScoredZones(candles, tfs, targetFactor) => ScoredZone[]`, `computeSdSignalEvents(candles, config?) => SignalEvent[]`, `computeSdSignals(candles, config?) => IndicatorResult`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/sdSignals.test.ts
import { describe, it, expect } from 'vitest';
import { computeSdSignals, computeSdSignalEvents } from './sdSignals';
import type { Candle } from '../types';

// 3 daily periods then intraday bars that dip into the prior-day demand and reject up.
// Build ~200 hourly candles so a 'D' zone forms; use a gentle uptrend into a pullback.
function synth(): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 220; i++) {
    const day = Math.floor(i / 24);
    // pull back on day 3, then rally
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
    const res = computeSdSignals(synth(), { id: 'sd_signals', settings: {} });
    expect(Array.isArray(res.signals)).toBe(true);
    expect(res.signals.length).toBe(synth().length);
    expect(Array.isArray(res.markers)).toBe(true);
  });

  it('emits events with the expected fields when a setup triggers', () => {
    const events = computeSdSignalEvents(synth(), { id: 'sd_signals', settings: {} });
    // Not asserting a specific count (depends on synth), just structural integrity:
    for (const e of events) {
      expect(['buy', 'sell']).toContain(e.side);
      if (e.state !== 'armed' && e.triggeredIndex != null) {
        expect(e.sl).not.toBeNaN();
        expect(e.tp1).not.toBeNaN();
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
  type ScoredZone, type SignalEvent, type SignalEngineConfig, type ConfirmationMode, type SlBufferMode,
} from './signalEngine';

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

/** Build + score every zone across the configured TFs (all history, not just current). */
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
    // Entry zones get a real score; target bands only supply geometry.
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

function resolveTfs(inp: SdSignalsInputs): HtfPeriod[] {
  return [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod => t === '4H' || t === 'D' || t === 'W' || t === 'M');
}

export function computeSdSignalEvents(candles: Candle[], config?: CustomIndicatorConfig): SignalEvent[] {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const tfs = resolveTfs(inp);
  if (candles.length === 0 || tfs.length === 0) return [];
  const zones = buildScoredZones(candles, tfs, inp.targetFactor);
  const atr = atrSeries(candles, 14);
  return generateSignals(candles, zones, atr, toEngineConfig(inp));
}

const TRIGGERED = new Set(['triggered', 'hit_tp1', 'hit_tp2', 'stopped', 'expired']);

export function computeSdSignals(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const events = computeSdSignalEvents(candles, config);
  const markers: IndicatorMarker[] = [];
  const levels: IndicatorLevel[] = [];

  for (const e of events) {
    if (e.triggeredIndex == null || !TRIGGERED.has(e.state)) continue;
    signals[e.triggeredIndex] = e.side;
    markers.push({
      index: e.triggeredIndex,
      position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: e.side === 'buy' ? '#26a69a' : '#f23645',
      shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: `${e.side === 'buy' ? 'BUY' : 'SELL'} ${e.zoneTf} ★${Math.round(e.confidence)} · R${e.rr1.toFixed(1)}`,
    });
  }

  // Active-signal overlay: the most-recent triggered event that is still open.
  const active = [...events].reverse().find((e) => e.state === 'triggered' || e.state === 'hit_tp1');
  if (active) {
    levels.push({ value: active.entry, color: '#2A62FF', lineStyle: 'solid', lineWidth: 1, title: `Entry ${active.entry.toFixed(1)}` });
    levels.push({ value: active.sl, color: '#f5a623', lineStyle: 'dashed', lineWidth: 1, title: `SL ${active.sl.toFixed(1)}` });
    levels.push({ value: active.tp1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${active.tp1.toFixed(1)}` });
    levels.push({ value: active.tp2, color: '#22d39a', lineStyle: 'dotted', lineWidth: 1, title: `TP2 ${active.tp2.toFixed(1)}` });
  }

  return { plots: [], signals, markers, levels };
}
```

Then register in `lib/customIndicatorsLibrary.ts` — add the import at the top with the other `./indicators/*` imports:

```ts
import { computeSdSignals } from './indicators/sdSignals';
```

and insert this object immediately after the `sd_zones` entry (after its `compute: computeSdZones,` and closing `},`):

```ts
  {
    id: 'sd_signals',
    name: 'Supply / Demand Signals',
    description: 'Non-repainting reversal Buy/Sell signals at S/D zones, with configurable stop-loss, TP1 (opposing zone) / TP2 (measured move), and a confidence score. Paper & educational — not financial advice.',
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

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run lib/indicators/sdSignals.test.ts && npx tsc --noEmit`
Expected: PASS + clean. Run `npx eslint lib/indicators/sdSignals.ts lib/customIndicatorsLibrary.ts` — clean.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/sdSignals.ts lib/indicators/sdSignals.test.ts lib/customIndicatorsLibrary.ts
git commit -m "feat(signals): sd_signals glue + indicator registration"
```

---

### Task 8: Signals panel (list + explanation)

**Files:**
- Create: `components/trade/SignalsPanel.tsx`
- Test: `components/trade/SignalsPanel.test.tsx`

**Interfaces:**
- Consumes: `SignalEvent` (Task 4); `Panel` from `@/components/ui`; `Num` from `@/components/ui`.
- Produces: `SignalsPanel({ events }: { events: SignalEvent[] })` default export.

**Note:** verify `Num` sub-components exist (`grep -n "Num.Price\|Num.Pct\|export .*Num" components/ui/*.tsx`); if a needed variant is missing use `Num` generic or plain text — do NOT use `toFixed` in an `app/**` file, but this component lives in `components/**` where the lint rule is advisory. Prefer `Num.*` regardless (B5-FREEZE).

- [ ] **Step 1: Write the failing test**

```tsx
// components/trade/SignalsPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SignalsPanel from './SignalsPanel';
import type { SignalEvent } from '@/lib/indicators/signalEngine';

const ev: SignalEvent = {
  id: 'buy:D:demand:0', side: 'buy', zoneTf: 'D', zoneKind: 'demand', zoneUpper: 105, zoneLower: 100,
  entry: 108, sl: 99, tp1: 130, tp2: 140, rr1: 2.4, confidence: 82,
  explanation: { factors: [{ key: 'zoneStrength', label: 'Zone strength', input: 0.9, weight: 0.35, contribution: 31.5 }], summary: 'Strong demand zone, 2.4R', counterSignals: ['retested 3×'] },
  tier: 'strong', state: 'triggered', armedIndex: 2, triggeredIndex: 3, resolvedIndex: null,
  armedTime: 0, triggeredTime: 1_600_000_000, resolvedTime: null,
};

describe('SignalsPanel', () => {
  it('renders a signal row with side and confidence', () => {
    render(<SignalsPanel events={[ev]} />);
    expect(screen.getByText(/BUY/)).toBeTruthy();
    expect(screen.getByText(/82/)).toBeTruthy();
  });
  it('expands to show the explanation factors and counter-signals', () => {
    render(<SignalsPanel events={[ev]} />);
    fireEvent.click(screen.getByRole('button', { name: /buy:D:demand:0/i }));
    expect(screen.getByText(/Zone strength/)).toBeTruthy();
    expect(screen.getByText(/retested 3×/)).toBeTruthy();
  });
  it('shows the empty state when there are no signals', () => {
    render(<SignalsPanel events={[]} />);
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
import type { SignalEvent } from '@/lib/indicators/signalEngine';

const band = (c: number): string => (c >= 80 ? 'High' : c >= 65 ? 'Medium' : 'Low');
const stateLabel: Record<SignalEvent['state'], string> = {
  armed: 'Armed', triggered: 'Live', hit_tp1: 'TP1', hit_tp2: 'TP2',
  stopped: 'Stopped', invalidated: 'Void', expired: 'Expired',
};

export default function SignalsPanel({ events }: { events: SignalEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = events.filter((e) => e.triggeredIndex != null).slice().reverse();

  return (
    <Panel title="Signals">
      <p className="mb-2 text-[10px] text-ink-faint">
        Paper &amp; educational — not financial advice.
      </p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-muted">No signals yet.</p>
      ) : (
        <ul className="divide-y divide-line text-xs">
          {rows.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                aria-label={e.id}
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="focus-ring flex w-full items-center justify-between gap-2 py-2 text-left"
              >
                <span className={e.side === 'buy' ? 'font-semibold text-bull-bright' : 'font-semibold text-bear-bright'}>
                  {e.side === 'buy' ? 'BUY' : 'SELL'}
                </span>
                <span className="font-mono tabular-nums text-ink">{e.entry.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink-muted">R{e.rr1.toFixed(1)}</span>
                <span className="font-mono tabular-nums text-ink">{Math.round(e.confidence)} · {band(e.confidence)}</span>
                <span className="text-ink-faint">{stateLabel[e.state]}</span>
              </button>
              {open === e.id && (
                <div className="pb-2 pl-1 text-[11px] text-ink-muted">
                  <p className="mb-1 text-ink">{e.explanation.summary}</p>
                  <div className="grid grid-cols-2 gap-x-3">
                    <span>Entry {e.entry.toFixed(1)} · SL {e.sl.toFixed(1)}</span>
                    <span>TP1 {e.tp1.toFixed(1)} · TP2 {e.tp2.toFixed(1)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {e.explanation.factors.map((f) => (
                      <li key={f.key} className="flex items-center justify-between">
                        <span>{f.label}</span>
                        <span className="font-mono tabular-nums">+{f.contribution.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                  {e.explanation.counterSignals.length > 0 && (
                    <p className="mt-1 text-amber-400">⚠ {e.explanation.counterSignals.join(' · ')}</p>
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
Expected: PASS (3 tests). If `Panel`'s import path or `title` prop differs, run `grep -n "export function Panel\|export const Panel\|interface PanelProps" components/ui/*.tsx` and adjust the import/props to match — then re-run.

- [ ] **Step 5: Commit**

```bash
git add components/trade/SignalsPanel.tsx components/trade/SignalsPanel.test.tsx
git commit -m "feat(signals): SignalsPanel with expandable explanation"
```

---

### Task 9: Surface the panel in the dashboard + manual verification

**Files:**
- Modify: the trade/dashboard layout that renders the chart-side panels (find it first).

**Interfaces:**
- Consumes: `SignalsPanel` (Task 8), `computeSdSignalEvents` (Task 7), the candles the dashboard already has.

- [ ] **Step 1: Locate the mount point and the candle source**

Run: `grep -rn "TradingPanel\|OrderTicket\|usePaperStore()\|candles" components/ChartPanel.tsx | head -20`
and `grep -rn "TradingPanel\|<.*Panel" components/*.tsx app/**/*.tsx | grep -i trade | head`
Identify the component that has `candles` in scope and renders the right-hand trade panels (likely `components/ChartPanel.tsx`).

- [ ] **Step 2: Read Next.js docs if editing an app/ route**

If the mount point is under `app/`, first read the relevant guide in `node_modules/next/dist/docs/` (per AGENTS.md) before editing.

- [ ] **Step 3: Wire the panel**

In the identified component (where `candles` and `symbol` are in scope), add:

```tsx
import SignalsPanel from './trade/SignalsPanel'; // adjust relative path
import { computeSdSignalEvents } from '@/lib/indicators/sdSignals';
import { useMemo } from 'react';
// ...inside the component body:
const signalEvents = useMemo(
  () => computeSdSignalEvents(candles, { id: 'sd_signals', settings: {} }),
  [candles],
);
// ...in the JSX, near the other side panels:
<SignalsPanel events={signalEvents} />
```

Match the surrounding panel layout/props (spacing, wrappers) exactly.

- [ ] **Step 4: Verify build + suite**

Run: `npx tsc --noEmit && npx eslint components/ChartPanel.tsx && npx vitest run`
Expected: clean + full suite green (all prior + new tests).

- [ ] **Step 5: Manual verification**

Start `npm run dev`, open the app, add the **Supply / Demand Signals** indicator from the indicator library, and confirm:
- Buy/Sell arrows appear at zone rejections; entry/SL/TP lines show for the active signal.
- The Signals panel lists events; expanding a row shows the explanation factors + counter-signals.
- Refresh does not change past triggered signals (non-repaint).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(signals): surface SignalsPanel + sd_signals overlay in dashboard"
```

---

## Self-Review

**1. Spec coverage**
- §4 architecture (signalEngine, signalBacktest, glue, panel, registration) → Tasks 1–9. ✓
- §5 data model (SignalEvent, SignalFactor, SignalExplanation, ScoredZone) → Tasks 1,3,4. ✓
- §6 lifecycle state machine + non-repaint → Task 4 + Task 5 golden. ✓
- §7 entry/SL/targets (configurable SL modes; TP1 opposing zone; TP2 measured move) → Tasks 1,2,4. ✓
- §8 confidence + structured explanation (sorted factors, summary, counter-signals) → Task 3. ✓
- §9 config inputs (incl. slBufferMode/slBuffer) → Task 1 defaults + Task 7 registration. ✓
- §10 backtest metrics by tier/tf → Task 6. ✓
- §11 markers + per-bar signals + active overlay + Signals panel + disclaimer → Tasks 7,8,9. ✓
- §16 locked decisions (reversal-only, chart TF, zone+MM targets, separate indicator) → honored across glue/registration. ✓
- §12 subscription gate → intentionally out of scope (deferred). ✓

**2. Placeholder scan** — no TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency** — `SignalEngineConfig`/`DEFAULT_SIGNAL_CONFIG` defined once (Task 1) and reused; `ScoredZone` fields (`strength`, `isConfluence`, `retestCount`) defined Task 1, consumed Tasks 2–4,7; `SignalEvent` defined Task 4, consumed Tasks 6,8; `computeStopLoss`/`computeTargets`/`computeConfidence` signatures match their call sites in `generateSignals`. ✓

**Known approximation (documented):** `buildScoredZones` scores every historical zone using the full-history confluence set rather than as-of-formation context — acceptable for Phase-1 hypothetical backtesting; noted for a future refinement if track-record accuracy demands it.
