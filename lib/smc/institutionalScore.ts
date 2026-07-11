// Institutional score: weighted blend of module scores (weights come from
// config, never hardcoded) with a confluence adjustment, plus the setup state
// machine (spec §6):
//
//   none → watch → building → ready → confirmed → exhausted
//                       ↘ invalidated (from any pre-confirmed state)

import {
  clampScore,
  biasToDirection,
  type Bias,
  type InstitutionalWeights,
  type SetupState,
  type SmcDirection,
} from './types';
import type { ModuleScores } from './confluence';

export interface SetupTrigger {
  /** A BOS/CHoCH/sweep in the bias direction fired this bar. */
  hasDirectionalEvent: boolean;
  /** A qualifying object was mitigated against the bias direction. */
  qualifyingObjectMitigatedAgainst: boolean;
  /** Price is inside a live qualifying object (OB/FVG) aligned with the bias. */
  insideQualifyingObject: boolean;
  /** Price is within reach of a qualifying object (approach heuristic). */
  approachingQualifyingObject: boolean;
}

export interface InstitutionalResult {
  institutional: number;
  bias: SmcDirection | null;
  setup: SetupState;
}

// v1 thresholds (spec §6). Tunable in one place.
const WATCH_AT = 50;
const BUILDING_AT = 65;
const READY_AT = 75;
const EXHAUST_BELOW = 50;
const RESET_BELOW = 30;

export function computeInstitutional(
  m: ModuleScores,
  confluence: number,
  weights: InstitutionalWeights,
  prevSetup: SetupState,
  trigger: SetupTrigger,
  swingTrend: Bias,
  internalTrend: Bias,
): InstitutionalResult {
  const sumW =
    weights.structure + weights.liquidity + weights.orderBlocks + weights.fvg + weights.premiumDiscount;
  const blended =
    sumW === 0
      ? 0
      : (m.structure * weights.structure +
          m.liquidity * weights.liquidity +
          m.orderBlocks * weights.orderBlocks +
          m.fvg * weights.fvg +
          m.premiumDiscount * weights.premiumDiscount) /
        sumW;
  const adjusted = blended + (confluence >= 70 ? 10 : confluence <= 30 ? -10 : 0);
  const institutional = clampScore(adjusted);

  const biasValue: Bias = swingTrend !== 0 ? swingTrend : internalTrend;
  const bias = biasToDirection(biasValue);
  const agree = bias !== null;

  let setup: SetupState = prevSetup;
  const preConfirmed = prevSetup === 'watch' || prevSetup === 'building' || prevSetup === 'ready';

  if (preConfirmed && trigger.qualifyingObjectMitigatedAgainst) {
    setup = 'invalidated';
  } else {
    switch (prevSetup) {
      case 'none':
        if (agree && institutional >= WATCH_AT) setup = 'watch';
        break;
      case 'watch':
        if (!agree || institutional < WATCH_AT) setup = 'none';
        else if (institutional >= BUILDING_AT && trigger.approachingQualifyingObject) setup = 'building';
        break;
      case 'building':
        if (!agree || institutional < WATCH_AT) setup = 'none';
        else if (institutional >= READY_AT && trigger.insideQualifyingObject) setup = 'ready';
        break;
      case 'ready':
        if (trigger.hasDirectionalEvent) setup = 'confirmed';
        else if (!agree || institutional < BUILDING_AT) setup = 'watch';
        break;
      case 'confirmed':
        if (institutional < EXHAUST_BELOW) setup = 'exhausted';
        break;
      case 'exhausted':
      case 'invalidated':
        if (institutional < RESET_BELOW) setup = 'none';
        else if (agree && institutional >= READY_AT) setup = 'watch'; // fresh cycle on renewed strength
        break;
    }
  }

  return { institutional, bias, setup };
}
