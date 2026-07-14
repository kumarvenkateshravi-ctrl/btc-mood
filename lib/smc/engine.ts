// SMC Intelligence Engine — pure batch API over one sequential bar-by-bar
// pass (Pine `var` semantics live inside the per-pass module factories).
// Assembles the SmcSnapshot: { metadata, state, objects, events, scores,
// diagnostics }. Consumers cache on a closed-bar signature; this function
// itself is pure and allocates all state per call.

import type { Candle } from '@/lib/types';
import {
  resolveSmcConfig,
  biasToDirection,
  BULLISH,
  type SmcConfig,
  type SmcDirection,
  type SmcEvent,
  type SmcObject,
  type SmcSnapshot,
  type SetupState,
  type ZoneName,
} from './types';
import { computeVolatility } from './volatility';
import { createStructureEngine } from './marketStructure';
import { createOrderBlockEngine } from './orderBlocks';
import { createLiquidityEngine } from './liquidity';
import { createFvgEngine } from './fvg';
import { computeZones } from './premiumDiscount';
import { obStrength, fvgStrength, poolStrength, structureStrength, qualityOf, confidenceOf } from './scoring';
import { computeModuleScores, confluenceScore } from './confluence';
import { computeInstitutional } from './institutionalScore';

/** Bars of event history considered "recent" by the structure module score. */
const RECENT_EVENT_BARS = 20;
/** "Approaching" = within this many ATRs of a qualifying object. */
const APPROACH_ATR = 2;

export function computeSmc(candles: Candle[], config?: Partial<SmcConfig>): SmcSnapshot {
  const t0 = performance.now();
  const cfg = resolveSmcConfig(config);
  const warnings: string[] = [];
  const events: SmcEvent[] = [];

  const empty: SmcSnapshot = {
    metadata: { version: cfg.version, config: cfg },
    state: {
      swingTrend: 0,
      internalTrend: 0,
      zone: 'equilibrium',
      trailing: { top: NaN, bottom: NaN, barIndex: 0, barTime: 0, lastTopTime: 0, lastBottomTime: 0 },
      setup: 'none',
      setupDirection: null,
    },
    objects: { orderBlocks: [], fvgs: [], liquidityPools: [], structureLevels: [], zones: [] },
    events,
    scores: { structure: 0, liquidity: 0, orderBlocks: 0, fvg: 0, premiumDiscount: 50, confluence: 30, institutional: 0 },
    diagnostics: { barsProcessed: 0, computeMs: 0, version: cfg.version, warnings },
  };
  if (candles.length === 0) {
    empty.diagnostics.computeMs = performance.now() - t0;
    return empty;
  }

  const vol = computeVolatility(candles, cfg.obFilter);
  const structure = createStructureEngine(candles, cfg, events);
  const orderBlocks = createOrderBlockEngine(candles, cfg, vol, events);
  const liquidity = createLiquidityEngine(candles, cfg, vol.atr200, events);
  const fvg = createFvgEngine(candles, cfg, events);

  let zone: ZoneName = 'equilibrium';
  let zoneObjects: SmcObject[] = [];
  let lastZoneDirection: SmcDirection = 'bullish';
  let setup: SetupState = 'none';
  let setupDirection: SmcDirection | null = null;
  let eventCursor = 0; // start of this bar's events (events are append-only, bar-ordered)
  // Rolling recency trackers (avoid rescanning the event log every bar).
  let lastBullBreakBar = -Infinity;
  let lastBearBreakBar = -Infinity;

  const refreshLiveMetrics = (objs: SmcObject[], i: number): void => {
    for (const o of objs) {
      const st = o.state;
      if (st !== 'active' && st !== 'tested' && st !== 'partial') continue;
      o.quality = qualityOf(o, i, cfg.maxAgeBars);
      o.confidence = confidenceOf(o, structure.swingTrend, structure.internalTrend, zone);
    }
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    eventCursor = events.length;

    const breaks = structure.onBar(i);
    orderBlocks.onBar(i, breaks);
    liquidity.onBar(i);
    fvg.onBar(i);

    // Strength is intrinsic and frozen at creation — set it for objects born
    // this bar (found via this bar's creation events).
    for (let e = eventCursor; e < events.length; e++) {
      const ev = events[e];
      const atr = vol.atr200[i] || 1;
      if (ev.type === 'OB_CREATED' && ev.objectId) {
        const ob = orderBlocks.blocks.find((b) => b.id === ev.objectId);
        if (ob) ob.strength = obStrength(Math.abs(c.close - (ob.direction === 'bullish' ? ob.bottom : ob.top)) / atr);
      } else if (ev.type === 'FVG_CREATED' && ev.objectId) {
        const gap = fvg.gaps.find((g) => g.id === ev.objectId);
        if (gap) gap.strength = fvgStrength((gap.top - gap.bottom) / atr);
      } else if ((ev.type === 'EQH_FORMED' || ev.type === 'EQL_FORMED') && ev.objectId) {
        const pool = liquidity.pools.find((p) => p.id === ev.objectId);
        if (pool) pool.strength = poolStrength(1);
      } else if (ev.type === 'SWING_FORMED' && ev.objectId) {
        const lvl = structure.structureLevels.find((l) => l.id === ev.objectId);
        if (lvl) {
          // Swing magnitude = trailing range; /4 keeps typical ranges in the
          // 1-3 "ATR multiples" the structureStrength formula expects.
          const magnitude = Number.isFinite(structure.trailing.top) && Number.isFinite(structure.trailing.bottom)
            ? Math.abs(structure.trailing.top - structure.trailing.bottom)
            : 0;
          lvl.strength = structureStrength(magnitude / atr / 4);
        }
      }
    }

    // Zones (need seeded trailing extremes).
    if (Number.isFinite(structure.trailing.top) && Number.isFinite(structure.trailing.bottom)) {
      const zs = computeZones(structure.trailing, c.close, i, c.time);
      zoneObjects = [zs.premium, zs.equilibrium, zs.discount];
      if (zs.zone !== zone) {
        zone = zs.zone;
        const direction: SmcDirection =
          zone === 'discount' ? 'bullish' : zone === 'premium' ? 'bearish' : lastZoneDirection;
        lastZoneDirection = direction;
        events.push({
          id: `ZONE_CHANGED_${i}`,
          type: 'ZONE_CHANGED',
          barIndex: i,
          time: c.time,
          direction,
          price: c.close,
        });
      }
    }

    // Per-bar quality/confidence for live objects, then module scores.
    refreshLiveMetrics(structure.structureLevels, i);
    refreshLiveMetrics(orderBlocks.blocks, i);
    refreshLiveMetrics(liquidity.pools, i);
    refreshLiveMetrics(fvg.gaps, i);

    // Scan only THIS bar's events once: update recency trackers and collect
    // the setup-machine trigger booleans without allocating.
    const biasValue = structure.swingTrend !== 0 ? structure.swingTrend : structure.internalTrend;
    const biasDir = biasToDirection(biasValue);
    let hasDirectionalEvent = false;
    let mitigatedAgainst = false;
    for (let e = eventCursor; e < events.length; e++) {
      const ev = events[e];
      if (ev.type === 'BOS' || ev.type === 'CHOCH') {
        if (ev.direction === 'bullish') lastBullBreakBar = i;
        else lastBearBreakBar = i;
      }
      if ((ev.type === 'BOS' || ev.type === 'CHOCH' || ev.type === 'LIQUIDITY_SWEEP') && ev.direction === biasDir) {
        hasDirectionalEvent = true;
      }
      if ((ev.type === 'OB_MITIGATED' || ev.type === 'FVG_FILLED') && ev.direction === biasDir) {
        mitigatedAgainst = true;
      }
    }

    const hasRecentTrendBreak =
      structure.swingTrend === BULLISH
        ? i - lastBullBreakBar <= RECENT_EVENT_BARS
        : structure.swingTrend !== 0
          ? i - lastBearBreakBar <= RECENT_EVENT_BARS
          : false;

    const moduleScores = computeModuleScores({
      structureLevels: structure.structureLevels,
      pools: liquidity.pools,
      blocks: orderBlocks.blocks,
      gaps: fvg.gaps,
      swingTrend: structure.swingTrend,
      internalTrend: structure.internalTrend,
      zone,
      hasRecentTrendBreak,
    });
    const confluence = confluenceScore(moduleScores, structure.swingTrend, structure.internalTrend);

    // Qualifying-object proximity, single pass over blocks + gaps, no allocs.
    const atr = vol.atr200[i] || 1;
    let inside = false;
    let approaching = false;
    if (biasDir) {
      const reach = APPROACH_ATR * atr;
      const check = (o: SmcObject): void => {
        const st = o.state;
        if (st !== 'active' && st !== 'tested' && st !== 'partial') return;
        if (o.direction !== biasDir) return;
        if (c.close <= o.top && c.close >= o.bottom) {
          inside = true;
          approaching = true;
        } else if (Math.min(Math.abs(c.close - o.top), Math.abs(c.close - o.bottom)) <= reach) {
          approaching = true;
        }
      };
      for (const o of orderBlocks.blocks) {
        if (inside) break;
        check(o);
      }
      if (!inside) for (const o of fvg.gaps) {
        if (inside) break;
        check(o);
      }
    }
    const trigger = {
      hasDirectionalEvent,
      qualifyingObjectMitigatedAgainst: mitigatedAgainst,
      insideQualifyingObject: inside,
      approachingQualifyingObject: approaching || inside,
    };

    const result = computeInstitutional(
      moduleScores,
      confluence,
      cfg.weights,
      setup,
      trigger,
      structure.swingTrend,
      structure.internalTrend,
    );
    setup = result.setup;
    setupDirection = setup === 'none' ? null : result.bias;

    // Final bar: assemble everything from this iteration's values.
    if (i === candles.length - 1) {
      empty.state = {
        swingTrend: structure.swingTrend,
        internalTrend: structure.internalTrend,
        zone,
        trailing: { ...structure.trailing },
        setup,
        setupDirection,
      };
      empty.objects = {
        orderBlocks: orderBlocks.blocks,
        fvgs: fvg.gaps,
        liquidityPools: liquidity.pools,
        structureLevels: structure.structureLevels,
        zones: zoneObjects,
      };
      empty.scores = {
        ...moduleScores,
        confluence,
        institutional: result.institutional,
      };
    }
  }

  empty.diagnostics.barsProcessed = candles.length;
  empty.diagnostics.computeMs = performance.now() - t0;
  return empty;
}

/**
 * Stable projection for golden/regression fixtures: everything meaningful,
 * nothing float-noisy or timing-dependent.
 */
export function projectSmcSnapshot(snap: SmcSnapshot) {
  return {
    events: snap.events.map((e) => ({
      t: e.type,
      i: e.barIndex,
      d: e.direction,
      s: e.scope ?? null,
      p: +e.price.toFixed(4),
    })),
    objects: Object.fromEntries(
      Object.entries(snap.objects).map(([k, list]) => [
        k,
        (list as SmcObject[]).map((o) => ({
          id: o.id,
          top: +o.top.toFixed(4),
          bottom: +o.bottom.toFixed(4),
          state: o.state,
        })),
      ]),
    ),
    scores: snap.scores,
    state: {
      swingTrend: snap.state.swingTrend,
      internalTrend: snap.state.internalTrend,
      zone: snap.state.zone,
      setup: snap.state.setup,
    },
  };
}

/**
 * computeSmc over only the most recent `maxBars`, with every bar index in the
 * snapshot shifted back into FULL-array space. Deep-loaded histories (tens of
 * thousands of bars) made the unbounded pass + its overlay rebuild stall the
 * chart during zoom-out; structure context beyond a few thousand bars adds
 * nothing to the read. Pure and deterministic like computeSmc itself.
 */
export function computeSmcWindowed(
  candles: Parameters<typeof computeSmc>[0],
  maxBars: number,
  config?: Parameters<typeof computeSmc>[1],
): SmcSnapshot {
  if (candles.length <= maxBars) return computeSmc(candles, config);
  const slice = candles.slice(-maxBars);
  const off = candles.length - slice.length;
  const snap = computeSmc(slice, config);
  const shiftObj = <T extends { createdAtBar: number; updatedAtBar: number }>(o: T): T => ({
    ...o,
    createdAtBar: o.createdAtBar + off,
    updatedAtBar: o.updatedAtBar + off,
  });
  return {
    ...snap,
    objects: {
      orderBlocks: snap.objects.orderBlocks.map(shiftObj),
      fvgs: snap.objects.fvgs.map(shiftObj),
      liquidityPools: snap.objects.liquidityPools.map(shiftObj),
      structureLevels: snap.objects.structureLevels.map(shiftObj),
      zones: snap.objects.zones.map(shiftObj),
    },
    events: snap.events.map((e) => ({ ...e, barIndex: e.barIndex + off })),
    state: {
      ...snap.state,
      trailing: { ...snap.state.trailing, barIndex: snap.state.trailing.barIndex + off },
    },
  };
}
