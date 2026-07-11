// Per-object metric formulas (spec §6). Three distinct concepts:
//  - strength:   intrinsic, frozen at creation (impulse magnitude vs ATR)
//  - quality:    current condition (age decay, touches, fill state)
//  - confidence: context (trend + zone alignment)
// All return integers 0-100. v1 formulas — tunable; each has its own test so
// tuning is safe.

import { clampScore, type Bias, type SmcObject, type ZoneName, BULLISH, BEARISH } from './types';

/** OB strength from the displacement leaving the block, in ATR multiples. */
export function obStrength(displacementAtr: number): number {
  return clampScore(displacementAtr * 25);
}

/** FVG strength from gap size in ATR multiples. */
export function fvgStrength(gapSizeAtr: number): number {
  return clampScore(gapSizeAtr * 50);
}

/** Liquidity pool strength from the number of equal touches. */
export function poolStrength(touches: number): number {
  return clampScore(50 + touches * 25);
}

/** Structure-break strength from break magnitude in ATR multiples. */
export function structureStrength(breakMagnitudeAtr: number): number {
  return clampScore(breakMagnitudeAtr * 30);
}

/** Current condition: 100 base, -15 per touch, age decay up to -40; state caps. */
export function qualityOf(obj: SmcObject, currentBar: number, maxAgeBars: number): number {
  const age = Math.max(0, currentBar - obj.createdAtBar);
  let q = 100 - obj.touches * 15 - Math.floor((age / maxAgeBars) * 40);
  if (obj.state === 'tested') q = Math.min(q, 70);
  if (obj.state === 'partial') q = Math.min(q, 40);
  if (obj.state === 'mitigated' || obj.state === 'invalidated' || obj.state === 'archived') {
    q = Math.min(q, 10);
  }
  return clampScore(q);
}

/**
 * Context: +40 when the object's direction agrees with the swing trend,
 * +30 with the internal trend, +30 when zone-aligned (bullish in discount /
 * bearish in premium; equilibrium gives +15).
 */
export function confidenceOf(
  obj: SmcObject,
  swingTrend: Bias,
  internalTrend: Bias,
  zone: ZoneName,
): number {
  const dirBias = obj.direction === 'bullish' ? BULLISH : BEARISH;
  let c = 0;
  if (swingTrend === dirBias) c += 40;
  if (internalTrend === dirBias) c += 30;
  if (zone === 'equilibrium') c += 15;
  else if ((zone === 'discount' && obj.direction === 'bullish') || (zone === 'premium' && obj.direction === 'bearish')) c += 30;
  return clampScore(c);
}
