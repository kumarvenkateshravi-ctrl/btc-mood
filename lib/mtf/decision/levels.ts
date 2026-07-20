// M9 — levels core. Prices the setup from ATR + confirmed swing structure on the
// execution timeframe's closed bars. assembleSetup is the SINGLE place derived
// numbers are computed (entry type, distancePct, targets, RR) — the SMC refiner
// reuses it so core and refined setups can never drift.

import type { Candle } from '../../types';
import * as pm from '../../pineMath';
import { DECISION_CONFIG } from './config';
import type { PriceLevel, TradeSetup, TradeSide } from './decisionTypes';
import { lastConfirmedSwings } from './swings';

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Last RMA(TR) value — same TradingView-faithful math as lib/indicators/atr.ts,
 *  without the chart-plot wrapper. */
export function lastAtr(candles: Candle[], length = DECISION_CONFIG.atrLength): number | null {
  const atr = pm.rma(pm.tr(candles), length).at(-1);
  return typeof atr === 'number' && Number.isFinite(atr) && atr > 0 ? atr : null;
}

export function assembleSetup(args: {
  side: TradeSide;
  zone: [number, number];
  entryBasis: PriceLevel;
  stop: PriceLevel;
  structuralTarget: PriceLevel | null;
  atr: number;
  lastClose: number;
}): TradeSetup {
  const { side, zone, entryBasis, stop, structuralTarget, atr, lastClose } = args;
  const entryMid = (zone[0] + zone[1]) / 2;
  const risk = side === 'long' ? entryMid - stop.price : stop.price - entryMid;
  const type = lastClose >= zone[0] && lastClose <= zone[1] ? 'market' as const : 'pullback' as const;
  const measured = r2(side === 'long'
    ? entryMid + DECISION_CONFIG.targetRR * risk
    : entryMid - DECISION_CONFIG.targetRR * risk);
  const measuredLevel = {
    price: measured,
    source: 'atr' as const,
    description: structuralTarget
      ? `Measured move at ${DECISION_CONFIG.targetRR}R`
      : `No structural obstacle; measured move at ${DECISION_CONFIG.targetRR}R`,
    rr: DECISION_CONFIG.targetRR,
  };
  const targets = structuralTarget
    ? [
        {
          ...structuralTarget,
          rr: r2((side === 'long' ? structuralTarget.price - entryMid : entryMid - structuralTarget.price) / risk),
        },
        measuredLevel,
      ]
    : [measuredLevel];
  return {
    entry: { zone, type, basis: entryBasis },
    stop: { ...stop, distancePct: r2((risk / entryMid) * 100) },
    targets,
    rr: targets[0].rr,
    atr,
  };
}

export type LevelsOutcome =
  | { kind: 'setup'; setup: TradeSetup; lastClose: number; swingHigh: number | null; swingLow: number | null }
  | { kind: 'block'; block: 'insufficient_structure' | 'rr_too_low'; rawRR: number | null;
      swingHigh: number | null; swingLow: number | null };

export function buildSetup(side: TradeSide, candles: Candle[]): LevelsOutcome {
  const atr = lastAtr(candles);
  const { swingHigh, swingLow } = lastConfirmedSwings(candles);
  const sh = swingHigh?.price ?? null;
  const sl = swingLow?.price ?? null;
  const anchor = side === 'long' ? swingLow : swingHigh;
  if (!anchor || atr === null) {
    return { kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: sh, swingLow: sl };
  }
  const lastClose = candles[candles.length - 1].close;
  const stopPrice = r2(side === 'long'
    ? anchor.price - DECISION_CONFIG.stopAtrMult * atr
    : anchor.price + DECISION_CONFIG.stopAtrMult * atr);
  // Close already at/beyond the stop ⇒ the anchoring structure is broken.
  if (side === 'long' ? lastClose <= stopPrice : lastClose >= stopPrice) {
    return { kind: 'block', block: 'insufficient_structure', rawRR: null, swingHigh: sh, swingLow: sl };
  }
  const zone: [number, number] = side === 'long'
    ? [anchor.price, r2(anchor.price + DECISION_CONFIG.entryZoneAtrMult * atr)]
    : [r2(anchor.price - DECISION_CONFIG.entryZoneAtrMult * atr), anchor.price];
  const opposing = side === 'long' ? swingHigh : swingLow;
  const beyondZone = opposing && (side === 'long' ? opposing.price > zone[1] : opposing.price < zone[0]);
  const structuralTarget: PriceLevel | null = beyondZone
    ? {
        price: opposing.price,
        source: 'swing',
        description: `Most recent confirmed swing ${side === 'long' ? 'high' : 'low'}`,
      }
    : null;
  const setup = assembleSetup({
    side,
    zone,
    entryBasis: {
      price: anchor.price,
      source: 'swing',
      description: `Confirmed swing ${side === 'long' ? 'low' : 'high'} anchor`,
    },
    stop: {
      price: stopPrice,
      source: 'swing',
      description: `Beyond swing ${side === 'long' ? 'low' : 'high'} by ${DECISION_CONFIG.stopAtrMult} ATR`,
    },
    structuralTarget,
    atr,
    lastClose,
  });
  if (setup.rr < DECISION_CONFIG.minRR) {
    return { kind: 'block', block: 'rr_too_low', rawRR: setup.rr, swingHigh: sh, swingLow: sl };
  }
  return { kind: 'setup', setup, lastClose, swingHigh: sh, swingLow: sl };
}
