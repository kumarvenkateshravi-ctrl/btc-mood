# Market Structure Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `MarketStructureSnapshot` projection engine over `lib/smc` plus a Market Structure Engine card on `/custom-multi-timeframe`.

**Architecture:** `computeSmc()` (existing) → `createMarketStructureSnapshot()` (new pure projection in `lib/mtf/structureEngine.ts`) → `MarketStructureSnapshot` (reusable domain object) → `MarketStructureCard` renderer. Debug gating via a new shared `lib/debug.ts` service.

**Tech Stack:** TypeScript, Next.js app router page (client), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-market-structure-engine-design.md` — frozen.
- `lib/smc/` and `lib/alignment.ts` MUST NOT be modified.
- Engine module: pure, deterministic, closed-bar only; no UI/React/network imports.
- Defaults: `structureWindowBars: 20`, `timelineLength: 7`.
- Quality buckets: 90–100 Excellent, 75–89 Strong, 55–74 Moderate, 0–54 Weak.
- Structure age `null` (never 0) when no trend-flipping event.
- Timeline: oldest → newest; significant events only (LIQUIDITY_SWEEP, CHOCH, BOS, OB_CREATED, FVG_CREATED); items keep `eventId/eventType/barIndex/timestamp/direction`.
- Narratives descriptive only; banned vocabulary: likely, expected, will, probable, should, forecast, anticipate(d), predicted, prediction.
- Metadata: `engine: 'marketStructure'`, snapshotVersion, symbol, timeframe, lastClosedBarTime, createdAt, computationTimeMs, config.
- Domain semantics (from `lib/smc`): liquidity pool/sweep direction `'bearish'` = EQH = **buy-side**, `'bullish'` = EQL = **sell-side**; FVG filled = lifecycle `'mitigated'`; OB broken = `'invalidated'`; live states = active/tested/partial.
- Full pre-existing suite (830 tests) stays green: `npx vitest run`.

---

### Task 1: Shared debug service

**Files:**
- Create: `lib/debug.ts`
- Test: `lib/debug.test.ts`

**Interfaces:**
- Produces: `isDebugEnabled(scope: string): boolean` — consumed by the card in Task 3.

- [ ] **Step 1: Write failing test** (`lib/debug.test.ts`)

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { isDebugEnabled } from './debug';

const g = globalThis as { window?: unknown };

describe('isDebugEnabled', () => {
  afterEach(() => { delete g.window; });

  it('is false without a window (SSR)', () => {
    expect(isDebugEnabled('marketStructure')).toBe(false);
  });

  it('is false without ?debug', () => {
    g.window = { location: { search: '' } };
    expect(isDebugEnabled('marketStructure')).toBe(false);
  });

  it('is true for ?debug=1 (all scopes)', () => {
    g.window = { location: { search: '?debug=1' } };
    expect(isDebugEnabled('marketStructure')).toBe(true);
    expect(isDebugEnabled('scanner')).toBe(true);
  });

  it('is true for a named scope only', () => {
    g.window = { location: { search: '?debug=marketStructure' } };
    expect(isDebugEnabled('marketStructure')).toBe(true);
    expect(isDebugEnabled('scanner')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run lib/debug.test.ts` → FAIL (module not found)
- [ ] **Step 3: Implement** (`lib/debug.ts`)

```ts
// Central debug service. Components ask isDebugEnabled('<scope>') and never
// read the URL themselves, so the mechanism can change without touching UI.
// v1 mechanism: ?debug=1 enables every scope; ?debug=<scope> enables one.

export function isDebugEnabled(scope: string): boolean {
  const w = (globalThis as { window?: { location?: { search?: string } } }).window;
  const search = w?.location?.search;
  if (!search) return false;
  const v = new URLSearchParams(search).get('debug');
  return v === '1' || v === 'true' || v === scope;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/debug.test.ts` → 4 passed
- [ ] **Step 5: Commit** — `git add lib/debug.ts lib/debug.test.ts && git commit -m "feat(debug): central isDebugEnabled(scope) service"`

---

### Task 2: `lib/mtf/structureEngine.ts` — snapshot projection

**Files:**
- Create: `lib/mtf/structureEngine.ts`
- Test: `lib/mtf/structureEngine.test.ts`

**Interfaces:**
- Consumes: `SmcSnapshot`, `SmcEvent`, `SmcObject` from `@/lib/smc/types`; `Candle`, `Timeframe` from `@/lib/types`.
- Produces (Task 3 relies on these exact names):
  - `createMarketStructureSnapshot(input: StructureEngineInput, config?: Partial<StructureEngineConfig>): MarketStructureSnapshot`
  - `DEFAULT_STRUCTURE_ENGINE_CONFIG`, `QUALITY_THRESHOLDS`
  - Types: `MarketStructureSnapshot`, `StructureEngineInput`, `Section<T>`, `SectionState`, `TimelineItem`, `StructureQuality`

Full module code (implementation target — write exactly this):

```ts
// Market Structure Engine — pure projection of SmcSnapshot into a reusable
// MarketStructureSnapshot domain object (first specialized intelligence
// engine: Raw Engine → Snapshot Projection → Reusable Snapshot → Renderer).
// Spec: docs/superpowers/specs/2026-07-18-market-structure-engine-design.md
//
// Deterministic: same inputs ⇒ identical snapshot except metadata.createdAt
// and metadata.computationTimeMs. No UI/React/network imports.

import type { Candle, Timeframe } from '@/lib/types';
import type {
  SmcDirection, SmcEvent, SmcEventType, SmcObject, SmcSnapshot, ZoneName,
} from '@/lib/smc/types';
import { BULLISH, BEARISH } from '@/lib/smc/types';

// ------------------------------------------------------------------ config

export interface StructureEngineConfig {
  /** Rolling window (bars) for BOS/CHoCH counts and the per-TF strip. */
  structureWindowBars: number;
  /** Max significant events rendered in the timeline. */
  timelineLength: number;
}

export const DEFAULT_STRUCTURE_ENGINE_CONFIG: StructureEngineConfig = {
  structureWindowBars: 20,
  timelineLength: 7,
};

/** Structure Quality lower bounds (inclusive) — spec-frozen. */
export const QUALITY_THRESHOLDS = { excellent: 90, strong: 75, moderate: 55 } as const;

// ---------------------------------------------------------------- sections

export type SectionState =
  | 'ready' | 'warming_up' | 'insufficient_history' | 'disabled' | 'partial' | 'error';
export interface Section<T> { state: SectionState; data: T | null; }

export type StructureQuality = 'Excellent' | 'Strong' | 'Moderate' | 'Weak';
export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';
export type TrendWord = 'bullish' | 'bearish' | 'neutral';

export interface StructureData {
  trend: TrendWord;
  /** Last labeled swings, oldest → newest (≤3). */
  sequence: SwingLabel[];
  /** 0–100, from the SMC institutional score. */
  confidence: number;
  /** Bars since the last trend-flipping CHoCH (or first BOS); null = not yet established. */
  ageBars: number | null;
}
export interface LiquiditySideData { created: number; swept: number; active: number; createdToday: number; }
export interface LiquidityData { buySide: LiquiditySideData; sellSide: LiquiditySideData; }
export interface FvgSideData { created: number; open: number; filled: number; createdToday: number; stacked: number; }
export interface FvgData {
  bullish: FvgSideData; bearish: FvgSideData;
  /** open bullish − open bearish (positive = bullish). */
  netBias: number;
  freshestBarsAgo: number | null;
}
export interface ObSideData { created: number; fresh: number; mitigated: number; broken: number; createdToday: number; }
export interface NearestOb { direction: SmcDirection; price: number; distancePct: number; }
export interface OrderBlockData {
  bullish: ObSideData; bearish: ObSideData;
  nearestBullish: NearestOb | null; nearestBearish: NearestOb | null;
}
export interface BreakCounts { bullishBos: number; bearishBos: number; bullishChoch: number; bearishChoch: number; }
export interface StructureBreaksData {
  windowBars: number;
  window: BreakCounts;
  /** Full-history totals — kept for future consumers, not rendered. */
  lifetime: BreakCounts;
  perTf: Array<{ timeframe: Timeframe } & BreakCounts>;
}
export interface PremiumDiscountData { zone: ZoneName; description: string; }
export interface TimelineItem {
  eventId: string; eventType: SmcEventType; barIndex: number; timestamp: number;
  direction: SmcDirection; label: string;
}
export interface QualityData { classification: StructureQuality; confidence: number; summary: string; }

export interface MarketStructureSnapshot {
  metadata: {
    engine: 'marketStructure';
    snapshotVersion: string;
    symbol: string;
    timeframe: Timeframe;
    lastClosedBarTime: number;
    createdAt: number;
    computationTimeMs: number;
    config: StructureEngineConfig;
  };
  structure: Section<StructureData>;
  liquidity: Section<LiquidityData>;
  fvg: Section<FvgData>;
  orderBlocks: Section<OrderBlockData>;
  structureBreaks: Section<StructureBreaksData>;
  premiumDiscount: Section<PremiumDiscountData>;
  timeline: Section<{ items: TimelineItem[] }>;
  phase: Section<{ label: string }>;
  quality: Section<QualityData>;
  narratives: string[];
}

export interface StructureEngineInput {
  smc: SmcSnapshot;
  /** Closed candles of the selected timeframe. */
  candles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  /** Per-TF events for the BOS/CHoCH strip (matrix timeframes). */
  perTf?: Array<{ timeframe: Timeframe; events: SmcEvent[]; barsProcessed: number }>;
  /** Current Phase label from the SMC screener report (reused, not recomputed). */
  phaseLabel?: string | null;
}

// ----------------------------------------------------------------- helpers

const SNAPSHOT_VERSION = '1.0';
const LIVE = new Set(['active', 'tested', 'partial']);
const SIGNIFICANT = new Set<SmcEventType>(['LIQUIDITY_SWEEP', 'CHOCH', 'BOS', 'OB_CREATED', 'FVG_CREATED']);

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const cap = (d: SmcDirection): string => (d === 'bullish' ? 'Bullish' : 'Bearish');
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** UTC midnight of the day containing t (ms). */
function dayStartUtc(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function breakCounts(events: SmcEvent[], fromBar: number): BreakCounts {
  const c: BreakCounts = { bullishBos: 0, bearishBos: 0, bullishChoch: 0, bearishChoch: 0 };
  for (const e of events) {
    if (e.barIndex < fromBar) continue;
    if (e.type === 'BOS') e.direction === 'bullish' ? c.bullishBos++ : c.bearishBos++;
    else if (e.type === 'CHOCH') e.direction === 'bullish' ? c.bullishChoch++ : c.bearishChoch++;
  }
  return c;
}

/** Swing labels (HH/HL/LH/LL) from swing-scope SWING_FORMED events; the first
 * swing of each kind has no predecessor and is not labeled. */
function swingSequence(events: SmcEvent[]): SwingLabel[] {
  const labels: SwingLabel[] = [];
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const e of events) {
    if (e.type !== 'SWING_FORMED' || e.scope !== 'swing') continue;
    if (e.direction === 'bearish') { // swing high
      if (prevHigh != null) labels.push(e.price > prevHigh ? 'HH' : 'LH');
      prevHigh = e.price;
    } else {                          // swing low
      if (prevLow != null) labels.push(e.price > prevLow ? 'HL' : 'LL');
      prevLow = e.price;
    }
  }
  return labels.slice(-3);
}

/** Bars since the last trend-flipping swing CHoCH (or, if none ever, the
 * first swing BOS that established trend). null = not yet established. */
function structureAgeBars(events: SmcEvent[], lastBarIndex: number): number | null {
  const swingBreaks = events.filter((e) => (e.type === 'CHOCH' || e.type === 'BOS') && e.scope === 'swing');
  let anchor: SmcEvent | undefined;
  for (const e of swingBreaks) if (e.type === 'CHOCH') anchor = e; // last CHoCH
  anchor ??= swingBreaks.find((e) => e.type === 'BOS');           // else first BOS
  return anchor ? lastBarIndex - anchor.barIndex : null;
}

/** Count of open FVGs that overlap ≥1 other open FVG of the same direction.
 * Overlap rule (spec): min(a.top,b.top) > max(a.bottom,b.bottom). */
function stackedCount(open: SmcObject[]): number {
  let n = 0;
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    for (let j = 0; j < open.length; j++) {
      if (i === j) continue;
      const b = open[j];
      if (Math.min(a.top, b.top) > Math.max(a.bottom, b.bottom)) { n++; break; }
    }
  }
  return n;
}

function nearestOb(obs: SmcObject[], direction: SmcDirection, close: number): NearestOb | null {
  let best: NearestOb | null = null;
  for (const o of obs) {
    if (o.direction !== direction || !LIVE.has(o.state)) continue;
    const inside = close >= o.bottom && close <= o.top;
    const edge = inside ? close : close > o.top ? o.top : o.bottom;
    const distancePct = inside ? 0 : round2((Math.abs(close - edge) / close) * 100);
    if (!best || distancePct < best.distancePct) best = { direction, price: edge, distancePct };
  }
  return best;
}

function timelineLabel(e: SmcEvent): string {
  switch (e.type) {
    // Sweep/pool direction is the POOL's: 'bearish' = EQH = buy-side.
    case 'LIQUIDITY_SWEEP': return e.direction === 'bearish' ? 'Buy-side Liquidity Sweep' : 'Sell-side Liquidity Sweep';
    case 'CHOCH': return `${cap(e.direction)} CHoCH`;
    case 'BOS': return `${cap(e.direction)} BOS`;
    case 'OB_CREATED': return `${cap(e.direction)} Order Block Created`;
    case 'FVG_CREATED': return `${cap(e.direction)} FVG Created`;
    default: return e.type;
  }
}

// ------------------------------------------------------------------ engine

export function createMarketStructureSnapshot(
  input: StructureEngineInput,
  config?: Partial<StructureEngineConfig>,
): MarketStructureSnapshot {
  const t0 = now();
  const cfg: StructureEngineConfig = { ...DEFAULT_STRUCTURE_ENGINE_CONFIG, ...config };
  const { smc, candles, symbol, timeframe } = input;
  const n = candles.length;
  const lastBarIndex = n - 1;
  const last = candles[lastBarIndex];
  const lastClosedBarTime = last?.time ?? 0;

  const metadata = (computationTimeMs: number): MarketStructureSnapshot['metadata'] => ({
    engine: 'marketStructure', snapshotVersion: SNAPSHOT_VERSION, symbol, timeframe,
    lastClosedBarTime, createdAt: Date.now(), computationTimeMs, config: cfg,
  });

  if (n === 0) {
    const empty = { state: 'insufficient_history' as const, data: null };
    return {
      metadata: metadata(round2(now() - t0)),
      structure: empty, liquidity: empty, fvg: empty, orderBlocks: empty,
      structureBreaks: empty, premiumDiscount: empty, timeline: empty,
      phase: empty, quality: empty, narratives: [],
    };
  }

  const dayStart = dayStartUtc(lastClosedBarTime);
  const createdToday = (o: SmcObject): boolean => o.createdAtTime >= dayStart;
  const events = smc.events;
  const trend: TrendWord =
    smc.state.swingTrend === BULLISH ? 'bullish' : smc.state.swingTrend === BEARISH ? 'bearish' : 'neutral';

  // ---- structure ----
  const established = trend !== 'neutral';
  const structure: Section<StructureData> = established
    ? {
        state: 'ready',
        data: {
          trend,
          sequence: swingSequence(events),
          confidence: smc.scores.institutional,
          ageBars: structureAgeBars(events, lastBarIndex),
        },
      }
    : { state: 'warming_up', data: null };

  // ---- liquidity (pool direction 'bearish' = EQH = buy-side) ----
  const pools = smc.objects.liquidityPools;
  const sideStats = (dir: SmcDirection): LiquiditySideData => {
    const side = pools.filter((p) => p.direction === dir);
    return {
      created: side.length,
      swept: side.filter((p) => p.state === 'mitigated').length,
      active: side.filter((p) => LIVE.has(p.state)).length,
      createdToday: side.filter(createdToday).length,
    };
  };
  const liquidityData: LiquidityData = { buySide: sideStats('bearish'), sellSide: sideStats('bullish') };
  const liquidity: Section<LiquidityData> = { state: 'ready', data: liquidityData };

  // ---- FVGs ----
  const fvgs = smc.objects.fvgs;
  const fvgSide = (dir: SmcDirection): FvgSideData => {
    const side = fvgs.filter((f) => f.direction === dir);
    const open = side.filter((f) => LIVE.has(f.state));
    return {
      created: side.length,
      open: open.length,
      filled: side.filter((f) => f.state === 'mitigated').length,
      createdToday: side.filter(createdToday).length,
      stacked: stackedCount(open),
    };
  };
  const bullFvg = fvgSide('bullish');
  const bearFvg = fvgSide('bearish');
  const openFvgs = fvgs.filter((f) => LIVE.has(f.state));
  const freshestBar = openFvgs.reduce((m, f) => Math.max(m, f.createdAtBar), -1);
  const fvg: Section<FvgData> = {
    state: 'ready',
    data: {
      bullish: bullFvg, bearish: bearFvg,
      netBias: bullFvg.open - bearFvg.open,
      freshestBarsAgo: freshestBar >= 0 ? lastBarIndex - freshestBar : null,
    },
  };

  // ---- order blocks ----
  const obs = smc.objects.orderBlocks;
  const obSide = (dir: SmcDirection): ObSideData => {
    const side = obs.filter((o) => o.direction === dir);
    return {
      created: side.length,
      fresh: side.filter((o) => o.state === 'active').length,
      mitigated: side.filter((o) => o.state === 'mitigated').length,
      broken: side.filter((o) => o.state === 'invalidated').length,
      createdToday: side.filter(createdToday).length,
    };
  };
  const close = last.close;
  const orderBlocks: Section<OrderBlockData> = {
    state: 'ready',
    data: {
      bullish: obSide('bullish'), bearish: obSide('bearish'),
      nearestBullish: nearestOb(obs, 'bullish', close),
      nearestBearish: nearestOb(obs, 'bearish', close),
    },
  };

  // ---- structure breaks (windowed; per-TF strip uses each TF's own bars) ----
  const windowFrom = Math.max(0, lastBarIndex - cfg.structureWindowBars + 1);
  const structureBreaks: Section<StructureBreaksData> = {
    state: 'ready',
    data: {
      windowBars: cfg.structureWindowBars,
      window: breakCounts(events, windowFrom),
      lifetime: breakCounts(events, 0),
      perTf: (input.perTf ?? []).map((p) => ({
        timeframe: p.timeframe,
        ...breakCounts(p.events, Math.max(0, p.barsProcessed - cfg.structureWindowBars)),
      })),
    },
  };

  // ---- premium / discount ----
  const zone = smc.state.zone;
  const zoneDescription =
    zone === 'discount' ? 'Price sits inside the discount half of the current dealing range.'
    : zone === 'premium' ? 'Price sits inside the premium half of the current dealing range.'
    : 'Price sits near the midpoint of the current dealing range.';
  const premiumDiscount: Section<PremiumDiscountData> = { state: 'ready', data: { zone, description: zoneDescription } };

  // ---- timeline (significant only, consecutive dupes collapsed, oldest → newest) ----
  const significant = events.filter((e) => SIGNIFICANT.has(e.type));
  const collapsed: SmcEvent[] = [];
  for (const e of significant) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.type === e.type && prev.direction === e.direction) collapsed[collapsed.length - 1] = e;
    else collapsed.push(e);
  }
  const items: TimelineItem[] = collapsed.slice(-cfg.timelineLength).map((e) => ({
    eventId: e.id, eventType: e.type, barIndex: e.barIndex, timestamp: e.time,
    direction: e.direction, label: timelineLabel(e),
  }));
  const timeline: Section<{ items: TimelineItem[] }> =
    items.length > 0 ? { state: 'ready', data: { items } } : { state: 'warming_up', data: null };

  // ---- phase (from screener report; not recomputed here) ----
  const phase: Section<{ label: string }> = input.phaseLabel
    ? { state: 'ready', data: { label: input.phaseLabel } }
    : { state: 'warming_up', data: null };

  // ---- quality + summary ----
  const score = smc.scores.confluence;
  const classification: StructureQuality =
    score >= QUALITY_THRESHOLDS.excellent ? 'Excellent'
    : score >= QUALITY_THRESHOLDS.strong ? 'Strong'
    : score >= QUALITY_THRESHOLDS.moderate ? 'Moderate' : 'Weak';
  const opposingSweeps = trend === 'bullish' ? liquidityData.sellSide.swept : liquidityData.buySide.swept;
  const summary = !established
    ? 'Structure is neutral while the market builds its next dealing range.'
    : opposingSweeps > 0
      ? `${cap(trend)} structure remains intact despite recent ${trend === 'bullish' ? 'sell-side' : 'buy-side'} liquidity sweeps.`
      : `${cap(trend)} structure remains intact across the current dealing range.`;
  const quality: Section<QualityData> = established
    ? { state: 'ready', data: { classification, confidence: score, summary } }
    : { state: 'warming_up', data: null };

  // ---- narratives (descriptive only — see banned-vocabulary test) ----
  const narratives: string[] = [];
  if (established && opposingSweeps > 0) {
    narratives.push(
      `${trend === 'bullish' ? 'Sell-side' : 'Buy-side'} liquidity has been swept while ${trend} structure remains intact.`,
    );
  }
  const obData = orderBlocks.data!;
  if (obData.bullish.created !== obData.bearish.created) {
    const [a, b] = obData.bullish.created > obData.bearish.created ? ['Bullish', 'bearish'] : ['Bearish', 'bullish'];
    narratives.push(`${a} order blocks outnumber ${b} order blocks.`);
  }
  if (bullFvg.open !== bearFvg.open) {
    const [a, b] = bullFvg.open > bearFvg.open ? ['bullish', 'bearish'] : ['bearish', 'bullish'];
    narratives.push(`Open ${a} fair value gaps outnumber ${b} gaps.`);
  }
  narratives.push(
    zone === 'equilibrium'
      ? 'Price currently trades near equilibrium of the dealing range.'
      : `Price currently trades inside a ${zone} zone.`,
  );

  return {
    metadata: metadata(round2(now() - t0)),
    structure, liquidity, fvg, orderBlocks, structureBreaks, premiumDiscount,
    timeline, phase, quality, narratives,
  };
}
```

- [ ] **Step 1: Write failing tests** (`lib/mtf/structureEngine.test.ts`) — synthetic `SmcSnapshot` builder + the spec's test list (see code below)

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/types';
import type { SmcEvent, SmcObject, SmcSnapshot } from '@/lib/smc/types';
import { DEFAULT_SMC_CONFIG } from '@/lib/smc/types';
import {
  createMarketStructureSnapshot, DEFAULT_STRUCTURE_ENGINE_CONFIG, QUALITY_THRESHOLDS,
} from './structureEngine';

// ---- fixtures ----
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 6, 18); // 2026-07-18T00:00:00Z

function candles(n: number, start = T0 - 100 * HOUR): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * HOUR, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
  }));
}
function obj(p: Partial<SmcObject> & Pick<SmcObject, 'kind' | 'direction'>): SmcObject {
  return {
    id: `${p.kind}_${p.direction}_${p.createdAtBar ?? 0}`, scope: undefined, top: 110, bottom: 100,
    createdAtBar: 0, createdAtTime: T0 - 100 * HOUR, updatedAtBar: 0, state: 'active',
    touches: 0, strength: 50, quality: 50, confidence: 50, ...p,
  };
}
function ev(p: Partial<SmcEvent> & Pick<SmcEvent, 'type'>): SmcEvent {
  return { id: `${p.type}_${p.barIndex ?? 0}`, barIndex: 0, time: T0 - 100 * HOUR, direction: 'bullish', price: 100, ...p };
}
function snap(p?: {
  swingTrend?: 1 | -1 | 0; zone?: 'premium' | 'equilibrium' | 'discount';
  events?: SmcEvent[]; orderBlocks?: SmcObject[]; fvgs?: SmcObject[]; liquidityPools?: SmcObject[];
  confluence?: number; institutional?: number;
}): SmcSnapshot {
  return {
    metadata: { version: '1.0', config: DEFAULT_SMC_CONFIG },
    state: {
      swingTrend: p?.swingTrend ?? 1, internalTrend: 1, zone: p?.zone ?? 'discount',
      trailing: { top: 200, bottom: 90, barIndex: 0, barTime: T0, lastTopTime: T0, lastBottomTime: T0 },
      setup: 'none', setupDirection: null,
    },
    objects: {
      orderBlocks: p?.orderBlocks ?? [], fvgs: p?.fvgs ?? [],
      liquidityPools: p?.liquidityPools ?? [], structureLevels: [], zones: [],
    },
    events: p?.events ?? [],
    scores: {
      structure: 50, liquidity: 50, orderBlocks: 50, fvg: 50, premiumDiscount: 50,
      confluence: p?.confluence ?? 80, institutional: p?.institutional ?? 75,
    },
    diagnostics: { barsProcessed: 100, computeMs: 1, version: '1.0', warnings: [] },
  };
}
const input = (s: SmcSnapshot, c = candles(100), extra?: object) =>
  ({ smc: s, candles: c, symbol: 'BTCUSDT', timeframe: '1h' as const, ...extra });

// ---- tests ----
describe('createMarketStructureSnapshot', () => {
  it('fills metadata incl. engine identity and config', () => {
    const c = candles(100);
    const ms = createMarketStructureSnapshot(input(snap(), c));
    expect(ms.metadata.engine).toBe('marketStructure');
    expect(ms.metadata.snapshotVersion).toBe('1.0');
    expect(ms.metadata.symbol).toBe('BTCUSDT');
    expect(ms.metadata.timeframe).toBe('1h');
    expect(ms.metadata.lastClosedBarTime).toBe(c[99].time);
    expect(ms.metadata.config).toEqual(DEFAULT_STRUCTURE_ENGINE_CONFIG);
  });

  it('empty candles ⇒ every section insufficient_history', () => {
    const ms = createMarketStructureSnapshot(input(snap(), []));
    for (const s of [ms.structure, ms.liquidity, ms.fvg, ms.orderBlocks, ms.structureBreaks, ms.premiumDiscount, ms.timeline, ms.phase, ms.quality]) {
      expect(s).toEqual({ state: 'insufficient_history', data: null });
    }
    expect(ms.narratives).toEqual([]);
  });

  it('neutral swing trend ⇒ structure & quality warming_up', () => {
    const ms = createMarketStructureSnapshot(input(snap({ swingTrend: 0 })));
    expect(ms.structure.state).toBe('warming_up');
    expect(ms.quality.state).toBe('warming_up');
    expect(ms.liquidity.state).toBe('ready');
  });

  it('structure age: last swing CHoCH wins; null when no trend-flipping event', () => {
    const events = [
      ev({ type: 'BOS', scope: 'swing', barIndex: 10 }),
      ev({ type: 'CHOCH', scope: 'swing', barIndex: 60 }),
      ev({ type: 'CHOCH', scope: 'internal', barIndex: 90 }), // ignored (internal)
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structure.data?.ageBars).toBe(99 - 60);
    const none = createMarketStructureSnapshot(input(snap({ events: [] })));
    expect(none.structure.data?.ageBars).toBeNull();
  });

  it('swing sequence labels HH/HL and skips unlabeled first swings', () => {
    const events = [
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 110, barIndex: 10 }), // first high — unlabeled
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bullish', price: 100, barIndex: 20 }), // first low — unlabeled
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 120, barIndex: 30 }), // HH
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bullish', price: 105, barIndex: 40 }), // HL
      ev({ type: 'SWING_FORMED', scope: 'swing', direction: 'bearish', price: 130, barIndex: 50 }), // HH
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structure.data?.sequence).toEqual(['HH', 'HL', 'HH']);
  });

  it('liquidity: pool direction bearish = buy-side; created/swept/active split', () => {
    const pools = [
      obj({ kind: 'liquidityPool', direction: 'bearish', state: 'active' }),
      obj({ kind: 'liquidityPool', direction: 'bearish', state: 'mitigated', createdAtBar: 1 }),
      obj({ kind: 'liquidityPool', direction: 'bullish', state: 'mitigated', createdAtBar: 2 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ liquidityPools: pools })));
    expect(ms.liquidity.data?.buySide).toMatchObject({ created: 2, swept: 1, active: 1 });
    expect(ms.liquidity.data?.sellSide).toMatchObject({ created: 1, swept: 1, active: 0 });
  });

  it('createdToday uses the UTC day of the last closed bar', () => {
    const c = candles(100); // last bar T0 - HOUR... spans into T0-day
    const lastTime = c[99].time;
    const day = Date.UTC(2026, 6, new Date(lastTime).getUTCDate());
    const pools = [
      obj({ kind: 'liquidityPool', direction: 'bullish', createdAtTime: day + HOUR }),
      obj({ kind: 'liquidityPool', direction: 'bullish', createdAtTime: day - HOUR, createdAtBar: 1 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ liquidityPools: pools }), c));
    expect(ms.liquidity.data?.sellSide.createdToday).toBe(1);
  });

  it('FVG: open/filled split, net bias, freshest, stacked overlap rule', () => {
    const fvgs = [
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 110, bottom: 100, createdAtBar: 90 }),
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 105, bottom: 95, createdAtBar: 80 }),  // overlaps ↑
      obj({ kind: 'fvg', direction: 'bullish', state: 'active', top: 90, bottom: 85, createdAtBar: 70 }),   // disjoint
      obj({ kind: 'fvg', direction: 'bullish', state: 'mitigated', createdAtBar: 10 }),
      obj({ kind: 'fvg', direction: 'bearish', state: 'active', top: 130, bottom: 125, createdAtBar: 60 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ fvgs })));
    expect(ms.fvg.data?.bullish).toMatchObject({ created: 4, open: 3, filled: 1, stacked: 2 });
    expect(ms.fvg.data?.bearish).toMatchObject({ open: 1, stacked: 0 });
    expect(ms.fvg.data?.netBias).toBe(2);
    expect(ms.fvg.data?.freshestBarsAgo).toBe(99 - 90);
  });

  it('order blocks: lifecycle split and nearest with distance %', () => {
    // last close = 100.5 + 99 = 199.5
    const obs = [
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'active', top: 180, bottom: 170 }),
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'tested', top: 150, bottom: 140, createdAtBar: 1 }),
      obj({ kind: 'orderBlock', direction: 'bullish', state: 'invalidated', top: 120, bottom: 110, createdAtBar: 2 }),
      obj({ kind: 'orderBlock', direction: 'bearish', state: 'mitigated', top: 220, bottom: 210, createdAtBar: 3 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ orderBlocks: obs })));
    expect(ms.orderBlocks.data?.bullish).toMatchObject({ created: 3, fresh: 1, broken: 1, mitigated: 0 });
    expect(ms.orderBlocks.data?.nearestBullish?.price).toBe(180);
    expect(ms.orderBlocks.data?.nearestBullish?.distancePct).toBeCloseTo(((199.5 - 180) / 199.5) * 100, 2);
    expect(ms.orderBlocks.data?.nearestBearish).toBeNull(); // only OB is mitigated
  });

  it('windowed break counts respect structureWindowBars and config override', () => {
    const events = [
      ev({ type: 'BOS', direction: 'bullish', barIndex: 50 }),  // outside 20-bar window
      ev({ type: 'BOS', direction: 'bullish', barIndex: 95 }),
      ev({ type: 'CHOCH', direction: 'bearish', barIndex: 98 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    expect(ms.structureBreaks.data?.window).toEqual({ bullishBos: 1, bearishBos: 0, bullishChoch: 0, bearishChoch: 1 });
    expect(ms.structureBreaks.data?.lifetime.bullishBos).toBe(2);
    const wide = createMarketStructureSnapshot(input(snap({ events })), { structureWindowBars: 60 });
    expect(wide.structureBreaks.data?.window.bullishBos).toBe(2);
  });

  it('per-TF strip windows each timeframe by its own bar count', () => {
    const perTf = [{
      timeframe: '4h' as const, barsProcessed: 50,
      events: [ev({ type: 'BOS', direction: 'bearish', barIndex: 45 }), ev({ type: 'BOS', direction: 'bearish', barIndex: 10 })],
    }];
    const ms = createMarketStructureSnapshot(input(snap(), candles(100), { perTf }));
    expect(ms.structureBreaks.data?.perTf).toEqual([
      { timeframe: '4h', bullishBos: 0, bearishBos: 1, bullishChoch: 0, bearishChoch: 0 },
    ]);
  });

  it('timeline: significant only, collapsed, capped, oldest → newest, refs kept', () => {
    const events = [
      ev({ type: 'FVG_FILLED', barIndex: 1 }),                                    // excluded
      ev({ type: 'LIQUIDITY_SWEEP', direction: 'bullish', barIndex: 2, time: T0 - 98 * HOUR }),
      ev({ type: 'FVG_CREATED', direction: 'bullish', barIndex: 3 }),
      ev({ type: 'FVG_CREATED', direction: 'bullish', barIndex: 4 }),             // collapses with ↑
      ev({ type: 'CHOCH', direction: 'bullish', barIndex: 5 }),
      ev({ type: 'BOS', direction: 'bullish', barIndex: 6 }),
    ];
    const ms = createMarketStructureSnapshot(input(snap({ events })));
    const items = ms.timeline.data!.items;
    expect(items.map((i) => i.label)).toEqual([
      'Sell-side Liquidity Sweep', 'Bullish FVG Created', 'Bullish CHoCH', 'Bullish BOS',
    ]);
    expect(items[0]).toMatchObject({ eventType: 'LIQUIDITY_SWEEP', barIndex: 2, timestamp: T0 - 98 * HOUR });
    expect(items[0].eventId).toBeTruthy();
    const capped = createMarketStructureSnapshot(input(snap({ events })), { timelineLength: 2 });
    expect(capped.timeline.data!.items).toHaveLength(2);
  });

  it('no significant events ⇒ timeline warming_up; phase from screener label', () => {
    const ms = createMarketStructureSnapshot(input(snap({ events: [ev({ type: 'FVG_FILLED' })] })));
    expect(ms.timeline).toEqual({ state: 'warming_up', data: null });
    expect(ms.phase.state).toBe('warming_up');
    const withPhase = createMarketStructureSnapshot(input(snap(), candles(100), { phaseLabel: 'Waiting for Bullish Order Block Retest' }));
    expect(withPhase.phase).toEqual({ state: 'ready', data: { label: 'Waiting for Bullish Order Block Retest' } });
  });

  it('quality thresholds at boundaries; summary present', () => {
    const q = (confluence: number) =>
      createMarketStructureSnapshot(input(snap({ confluence }))).quality.data!.classification;
    expect(q(90)).toBe('Excellent');
    expect(q(89)).toBe('Strong');
    expect(q(75)).toBe('Strong');
    expect(q(74)).toBe('Moderate');
    expect(q(55)).toBe('Moderate');
    expect(q(54)).toBe('Weak');
    expect(QUALITY_THRESHOLDS).toEqual({ excellent: 90, strong: 75, moderate: 55 });
    const ms = createMarketStructureSnapshot(input(snap()));
    expect(ms.quality.data!.summary.length).toBeGreaterThan(0);
    expect(ms.quality.data!.confidence).toBe(80);
  });

  it('narratives are descriptive — banned predictive vocabulary never appears', () => {
    const banned = /\b(likely|expected|will|probable|should|forecast|anticipat\w*|predict\w*)\b/i;
    const cases = [
      snap(),
      snap({ swingTrend: -1, zone: 'premium', liquidityPools: [obj({ kind: 'liquidityPool', direction: 'bearish', state: 'mitigated' })] }),
      snap({
        zone: 'equilibrium',
        orderBlocks: [obj({ kind: 'orderBlock', direction: 'bullish' })],
        fvgs: [obj({ kind: 'fvg', direction: 'bearish' })],
        liquidityPools: [obj({ kind: 'liquidityPool', direction: 'bullish', state: 'mitigated' })],
      }),
    ];
    for (const s of cases) {
      const ms = createMarketStructureSnapshot(input(s));
      for (const line of [...ms.narratives, ms.quality.data?.summary ?? '']) {
        expect(line).not.toMatch(banned);
      }
      expect(ms.narratives.length).toBeGreaterThan(0);
    }
  });

  it('default-drift guard: implicit config === explicit defaults (modulo timing)', () => {
    const s = snap({ events: [ev({ type: 'BOS', barIndex: 95 })] });
    const strip = (m: ReturnType<typeof createMarketStructureSnapshot>) => ({
      ...m, metadata: { ...m.metadata, createdAt: 0, computationTimeMs: 0 },
    });
    const a = createMarketStructureSnapshot(input(s));
    const b = createMarketStructureSnapshot(input(s), { structureWindowBars: 20, timelineLength: 7 });
    expect(strip(a)).toEqual(strip(b));
  });

  it('determinism: same inputs ⇒ identical snapshot (modulo timing)', () => {
    const s = snap({ events: [ev({ type: 'CHOCH', scope: 'swing', barIndex: 40 })] });
    const strip = (m: ReturnType<typeof createMarketStructureSnapshot>) => ({
      ...m, metadata: { ...m.metadata, createdAt: 0, computationTimeMs: 0 },
    });
    expect(strip(createMarketStructureSnapshot(input(s)))).toEqual(strip(createMarketStructureSnapshot(input(s))));
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run lib/mtf/structureEngine.test.ts` → FAIL (module not found)
- [ ] **Step 3: Write the module** — exactly the code block above (`lib/mtf/structureEngine.ts`)
- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/mtf/structureEngine.test.ts` → all pass
- [ ] **Step 5: Commit** — `git add lib/mtf/structureEngine.ts lib/mtf/structureEngine.test.ts && git commit -m "feat(mtf): Market Structure Engine snapshot projection"`

---

### Task 3: Card renderer + page wiring

**Files:**
- Create: `components/mtf/MarketStructureCard.tsx`
- Modify: `app/custom-multi-timeframe/page.tsx`

**Interfaces:**
- Consumes: `createMarketStructureSnapshot` etc. (Task 2), `isDebugEnabled` (Task 1), `computeSmc` from `@/lib/smc/engine`, `evaluateSmcScreener` from `@/lib/smc/screener`, `Panel` from `@/components/ui`.
- Card props: `{ snapshot: MarketStructureSnapshot; cacheHit: boolean; tfOptions: Timeframe[]; selectedTf: Timeframe; onSelectTf: (tf: Timeframe) => void }`.

Implementation requirements (component code authored during execution, following the page's existing visual idiom — `Panel`, `text-ink-*`, `border-line`, `vColor`-style tones):

1. **Card sections** in order: header (title + TF selector buttons from `tfOptions`), Current Structure (trend word, sequence `HH → HL → HH`, confidence %, "Established N bars ago" or "Not yet established" when `ageBars === null`), Liquidity (buy/sell columns: created/swept/active + today), Fair Value Gaps (per-direction stats + stacked + net bias + freshest), Order Blocks (per-direction stats + nearest price/distance, `—` when null), Market Structure (window counts + per-TF strip), Premium/Discount (zone + description sentence), Timeline (oldest → newest labels with `↓` connectors, ending in Current Phase from `snapshot.phase`), Structure Quality (classification + summary), narratives list.
2. **Section states:** non-`ready` sections render a quiet placeholder ("Warming up…" / "Insufficient history") — never fake zeros.
3. **Diagnostics:** when `isDebugEnabled('marketStructure')`, render a collapsed `<details>` block: snapshotVersion, object/event counts (derived from the sections), computationTimeMs, lastClosedBarTime as UTC string, `cacheHit ? 'yes' : 'no'`.
4. **Page wiring** (`app/custom-multi-timeframe/page.tsx`):
   - Persist `structTf` to `localStorage['custom_mtf_structure_tf']` (load on mount with validation against `TIMEFRAMES`, save on change).
   - Closed-bar SMC cache: a `useRef<Map<Timeframe, { key: number; smc: SmcSnapshot }>>`; per TF, closed candles = `arr.slice(0, -1)`, key = last closed bar time; recompute only when the key changes; track `cacheHit` for the selected TF.
   - Screener report memo: `evaluateSmcScreener(closedByTf, structTf)` keyed the same way; pass `report.currentPhase` as `phaseLabel`.
   - Build `perTf` from all cached TF snapshots (`events`, `diagnostics.barsProcessed`).
   - Render `<MarketStructureCard …/>` in the left column below the Timeframe Summary panel.

- [ ] **Step 1: Implement `components/mtf/MarketStructureCard.tsx`** per requirements above
- [ ] **Step 2: Wire the page** per requirement 4
- [ ] **Step 3: Typecheck + tests** — `npx tsc --noEmit` → 0 errors; `npx vitest run` → full suite green
- [ ] **Step 4: Verify live** — dev server, `/custom-multi-timeframe` shows the card; `?debug=1` shows diagnostics
- [ ] **Step 5: Commit** — `git add components/mtf/MarketStructureCard.tsx app/custom-multi-timeframe/page.tsx && git commit -m "feat(custom-mtf): Market Structure Engine card"`

---

### Task 4: Full verification + graph refresh

- [ ] **Step 1:** `npx vitest run` → entire suite green (830 pre-existing + new)
- [ ] **Step 2:** `npx tsc --noEmit` → 0 errors
- [ ] **Step 3:** `graphify update .` (AST-only refresh)
- [ ] **Step 4:** Commit any remaining artifacts; report results with counts
