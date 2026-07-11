// Cross-module aggregation: per-module scores from live objects, plus the
// confluence (agreement) score. Consumed by institutionalScore.ts.
//
// Module score v1: mean of the top-3 live objects' (strength+quality+confidence)/3
// for the module's kind; structure additionally +15 when a recent BOS/CHoCH
// agrees with the trend. premiumDiscount scores zone alignment with the bias.

import {
  clampScore,
  BULLISH,
  BEARISH,
  type Bias,
  type SmcEvent,
  type SmcObject,
  type ZoneName,
} from './types';

export interface ModuleScores {
  structure: number;
  liquidity: number;
  orderBlocks: number;
  fvg: number;
  premiumDiscount: number;
}

const LIVE = new Set(['active', 'tested', 'partial']);

function topObjectsScore(objects: SmcObject[]): number {
  const live = objects
    .filter((o) => LIVE.has(o.state))
    .map((o) => (o.strength + o.quality + o.confidence) / 3)
    .sort((a, b) => b - a)
    .slice(0, 3);
  if (live.length === 0) return 0;
  return clampScore(live.reduce((s, v) => s + v, 0) / live.length);
}

export function computeModuleScores(input: {
  structureLevels: SmcObject[];
  pools: SmcObject[];
  blocks: SmcObject[];
  gaps: SmcObject[];
  swingTrend: Bias;
  internalTrend: Bias;
  zone: ZoneName;
  /** Events within the recency window (engine passes the last 20 bars). */
  recentEvents: SmcEvent[];
}): ModuleScores {
  let structure = topObjectsScore(input.structureLevels);
  const trendDir = input.swingTrend === BULLISH ? 'bullish' : input.swingTrend === BEARISH ? 'bearish' : null;
  if (
    trendDir &&
    input.recentEvents.some((e) => (e.type === 'BOS' || e.type === 'CHOCH') && e.direction === trendDir)
  ) {
    structure = clampScore(structure + 15);
  }

  const bias: Bias = input.swingTrend !== 0 ? input.swingTrend : input.internalTrend;
  const premiumDiscount =
    bias === 0
      ? 50
      : input.zone === 'equilibrium'
        ? 50
        : (input.zone === 'discount' && bias === BULLISH) || (input.zone === 'premium' && bias === BEARISH)
          ? 80
          : 20;

  return {
    structure,
    liquidity: topObjectsScore(input.pools),
    orderBlocks: topObjectsScore(input.blocks),
    fvg: topObjectsScore(input.gaps),
    premiumDiscount,
  };
}

/** Trend agreement base (60 agree / 30 otherwise) + 10 per module ≥ 60. */
export function confluenceScore(m: ModuleScores, swingTrend: Bias, internalTrend: Bias): number {
  const base = swingTrend !== 0 && swingTrend === internalTrend ? 60 : 30;
  const strongModules = [m.structure, m.liquidity, m.orderBlocks, m.fvg, m.premiumDiscount].filter(
    (s) => s >= 60,
  ).length;
  return clampScore(base + strongModules * 10);
}
