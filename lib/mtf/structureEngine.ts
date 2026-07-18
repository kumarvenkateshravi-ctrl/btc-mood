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
export type StructureQualityWord = 'Strong' | 'Moderate' | 'Developing';
export type NarrativeCategory = 'Liquidity' | 'Structure' | 'FVG' | 'Premium';
export interface Narrative { category: NarrativeCategory; text: string; }

export interface StructureData {
  trend: TrendWord;
  /** Last labeled swings, oldest → newest (≤3). */
  sequence: SwingLabel[];
  /** 0–100, from the SMC institutional score. */
  confidence: number;
  /** Bars since the last trend-flipping CHoCH (or first BOS); null = not yet established. */
  ageBars: number | null;
  /** Word form of confidence, distinct from the raw percentage. */
  qualityWord: StructureQualityWord;
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
  narratives: Narrative[];
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

const SNAPSHOT_VERSION = '1.1';
const LIVE = new Set(['active', 'tested', 'partial']);

function qualityWordFor(confidence: number): StructureQualityWord {
  return confidence >= 70 ? 'Strong' : confidence >= 45 ? 'Moderate' : 'Developing';
}
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
    if (e.type === 'BOS') {
      if (e.direction === 'bullish') c.bullishBos++; else c.bearishBos++;
    } else if (e.type === 'CHOCH') {
      if (e.direction === 'bullish') c.bullishChoch++; else c.bearishChoch++;
    }
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
          qualityWord: qualityWordFor(smc.scores.institutional),
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
      ? `${cap(trend as SmcDirection)} structure remains intact despite recent ${trend === 'bullish' ? 'sell-side' : 'buy-side'} liquidity sweeps.`
      : `${cap(trend as SmcDirection)} structure remains intact across the current dealing range.`;
  const quality: Section<QualityData> = established
    ? { state: 'ready', data: { classification, confidence: score, summary } }
    : { state: 'warming_up', data: null };

  // ---- narratives (descriptive only — see banned-vocabulary test) ----
  const narratives: Narrative[] = [];
  if (established && opposingSweeps > 0) {
    narratives.push({
      category: 'Liquidity',
      text: `${trend === 'bullish' ? 'Sell-side' : 'Buy-side'} liquidity has been swept while ${trend} structure remains intact.`,
    });
  }
  const obData = orderBlocks.data!;
  if (obData.bullish.created !== obData.bearish.created) {
    const [a, b] = obData.bullish.created > obData.bearish.created ? ['Bullish', 'bearish'] : ['Bearish', 'bullish'];
    narratives.push({ category: 'Structure', text: `${a} order blocks outnumber ${b} order blocks.` });
  }
  if (bullFvg.open !== bearFvg.open) {
    const [a, b] = bullFvg.open > bearFvg.open ? ['bullish', 'bearish'] : ['bearish', 'bullish'];
    narratives.push({ category: 'FVG', text: `Open ${a} fair value gaps outnumber ${b} gaps.` });
  }
  narratives.push({
    category: 'Premium',
    text: zone === 'equilibrium'
      ? 'Price currently trades near equilibrium of the dealing range.'
      : `Price currently trades inside a ${zone} zone.`,
  });

  return {
    metadata: metadata(round2(now() - t0)),
    structure, liquidity, fvg, orderBlocks, structureBreaks, premiumDiscount,
    timeline, phase, quality, narratives,
  };
}
