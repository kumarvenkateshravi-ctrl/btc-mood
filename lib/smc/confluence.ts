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

/** Mean of the top-3 live objects' blended metric — single pass, no allocs
 *  (this runs once per kind per bar over ever-growing object lists). */
function topObjectsScore(objects: SmcObject[]): number {
  let a = -1;
  let b = -1;
  let c = -1;
  let count = 0;
  for (const o of objects) {
    const st = o.state;
    if (st !== 'active' && st !== 'tested' && st !== 'partial') continue;
    const v = (o.strength + o.quality + o.confidence) / 3;
    count++;
    if (v > a) {
      c = b;
      b = a;
      a = v;
    } else if (v > b) {
      c = b;
      b = v;
    } else if (v > c) {
      c = v;
    }
  }
  if (count === 0) return 0;
  const n = Math.min(3, count);
  return clampScore((a + (n > 1 ? b : 0) + (n > 2 ? c : 0)) / n);
}

export function computeModuleScores(input: {
  structureLevels: SmcObject[];
  pools: SmcObject[];
  blocks: SmcObject[];
  gaps: SmcObject[];
  swingTrend: Bias;
  internalTrend: Bias;
  zone: ZoneName;
  /** A BOS/CHoCH agreeing with the swing trend fired within the recency window. */
  hasRecentTrendBreak: boolean;
}): ModuleScores {
  let structure = topObjectsScore(input.structureLevels);
  if (input.swingTrend !== 0 && input.hasRecentTrendBreak) {
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
