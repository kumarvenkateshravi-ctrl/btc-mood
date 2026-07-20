// M9 — SMC confluence refiner. OPTIONAL, bounded, additive: adjusts the levels
// core within config tolerances only, emits a ConfluenceNote for every change,
// and reproduces the core byte-for-byte when nothing is eligible. Order/FVG
// objects are matched by direction; liquidity pools by geometry only. Every
// adjustment is rebuilt through assembleSetup — numbers are never hand-mutated.

import type { SmcObject, SmcSnapshot } from '../../smc/types';
import { DECISION_CONFIG } from './config';
import type { ConfluenceNote, DecisionSignal, PriceLevel, TradeSetup, TradeSide } from './decisionTypes';
import { assembleSetup } from './levels';

type SmcObjects = SmcSnapshot['objects'];

const r2 = (x: number) => Math.round(x * 100) / 100;
const ELIGIBLE = new Set(['active', 'tested']);

const mid = (zone: [number, number]) => (zone[0] + zone[1]) / 2;

/** Distance between the entry zone and an object band; 0 when they overlap. */
const gapTo = (zone: [number, number], bottom: number, top: number) =>
  Math.max(zone[0] - top, bottom - zone[1], 0);

/** Recover the structural target from a setup (targets[0] unless it is the measured level). */
const structuralOf = (setup: TradeSetup): PriceLevel | null => {
  if (setup.targets.length < 2) return null;
  const { price, source, description } = setup.targets[0];
  return { price, source, description };
};

export function applySmcConfluence(
  setup: TradeSetup,
  side: TradeSide,
  lastClose: number,
  objects: SmcObjects,
): { setup: TradeSetup; notes: ConfluenceNote[]; warnings: DecisionSignal[] } {
  const notes: ConfluenceNote[] = [];
  const warnings: DecisionSignal[] = [];
  const { atr } = setup;
  const supportDirection = side === 'long' ? 'bullish' : 'bearish';
  let current = setup;

  const rebuild = (patch: {
    zone?: [number, number]; entryBasis?: PriceLevel; stop?: PriceLevel; structuralTarget?: PriceLevel | null;
  }) => {
    current = assembleSetup({
      side,
      zone: patch.zone ?? current.entry.zone,
      entryBasis: patch.entryBasis ?? current.entry.basis,
      stop: patch.stop ?? {
        price: current.stop.price, source: current.stop.source, description: current.stop.description,
      },
      structuralTarget: 'structuralTarget' in patch ? patch.structuralTarget! : structuralOf(current),
      atr,
      lastClose,
    });
  };

  // 1. Entry snap — nearest supporting order block / FVG within tolerance of the zone.
  type ZoneCandidate = { o: SmcObject; kind: 'orderBlock' | 'fvg' };
  const zones = ([] as ZoneCandidate[])
    .concat(
      objects.orderBlocks.map((o): ZoneCandidate => ({ o, kind: 'orderBlock' })),
      objects.fvgs.map((o): ZoneCandidate => ({ o, kind: 'fvg' })),
    )
    .filter(({ o }) => ELIGIBLE.has(o.state) && o.direction === supportDirection)
    .map((e) => ({ ...e, gap: gapTo(current.entry.zone, e.o.bottom, e.o.top) }))
    .filter((e) => e.gap <= DECISION_CONFIG.smcSnapToleranceAtrMult * atr)
    .sort((a, b) => a.gap - b.gap);
  if (zones.length) {
    const { o, kind } = zones[0];
    const before = r2(mid(current.entry.zone));
    const newZone: [number, number] = [o.bottom, o.top];
    rebuild({
      zone: newZone,
      entryBasis: {
        price: side === 'long' ? o.bottom : o.top,
        source: kind === 'orderBlock' ? 'smc_orderblock' : 'smc_fvg',
        description: kind === 'orderBlock' ? 'Entry re-anchored to order block' : 'Entry re-anchored to fair value gap',
      },
    });
    notes.push({
      code: kind === 'orderBlock' ? 'ENTRY_SNAPPED_OB' : 'ENTRY_SNAPPED_FVG',
      message: `Entry zone re-anchored to a ${kind === 'orderBlock' ? 'n order block' : 'fair value gap'} in confluence`,
      field: 'entry', before, after: r2(mid(newZone)),
    });
  }

  // 2. Stop extension — deepest pool strictly beyond the stop within the bound.
  const pools = objects.liquidityPools.filter((o) => ELIGIBLE.has(o.state));
  const beyond = pools
    .map((o) => o.top)
    .filter((level) => (side === 'long'
      ? level < current.stop.price && current.stop.price - level <= DECISION_CONFIG.stopExtendMaxAtrMult * atr
      : level > current.stop.price && level - current.stop.price <= DECISION_CONFIG.stopExtendMaxAtrMult * atr))
    .sort((a, b) => (side === 'long' ? a - b : b - a));
  if (beyond.length) {
    const level = beyond[0];
    const before = current.stop.price;
    const newStop = r2(side === 'long'
      ? level - DECISION_CONFIG.stopBufferAtrMult * atr
      : level + DECISION_CONFIG.stopBufferAtrMult * atr);
    rebuild({ stop: { price: newStop, source: 'smc_liquidity', description: 'Extended past resting liquidity pool' } });
    notes.push({
      code: 'STOP_EXTENDED_LIQUIDITY',
      message: 'Stop extended past a resting liquidity pool sitting just beyond it',
      field: 'stop', before, after: newStop,
    });
    warnings.push({
      code: 'STOP_HUNT_RISK', severity: 'warning',
      message: 'A liquidity pool rests just beyond the structural stop — sweep risk before continuation',
    });
  }

  // 3. Target upgrade — nearest opposing pool between the zone and target 1,
  //    accepted only if the resulting RR clears minRR.
  const entryMid = mid(current.entry.zone);
  const risk = side === 'long' ? entryMid - current.stop.price : current.stop.price - entryMid;
  const zoneEdge = side === 'long' ? current.entry.zone[1] : current.entry.zone[0];
  const t1 = current.targets[0].price;
  const upgrades = pools
    .map((o) => o.top)
    .filter((level) => (side === 'long' ? level > zoneEdge && level < t1 : level < zoneEdge && level > t1))
    .filter((level) => r2((side === 'long' ? level - entryMid : entryMid - level) / risk) >= DECISION_CONFIG.minRR)
    .sort((a, b) => (side === 'long' ? a - b : b - a));
  if (upgrades.length) {
    const level = upgrades[0];
    rebuild({
      structuralTarget: { price: level, source: 'smc_liquidity', description: 'Opposing liquidity pool ahead of the structural target' },
    });
    notes.push({
      code: 'TARGET_LIQUIDITY',
      message: 'First target moved to an opposing liquidity pool sitting ahead of the structural target',
      field: 'target', before: t1, after: level,
    });
  }

  return { setup: current, notes, warnings };
}
