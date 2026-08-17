// Shared signal engine for "Moving Averages & FVG". The composite (index.ts)
// draws the plots and the Custom-MTF signal card both consume THIS — so the
// chart and the card can never produce different Buy/Sell signals.

import type { Candle } from '../../types';
import type { CustomIndicatorConfig } from '../../indicatorFramework';
import * as pm from '../../pineMath';
import { resolveInputs, resolveSourceNum } from '../itsTemplates';
import type { VwapAnchor } from '../vwapAnchor';
import { anchoredVwap } from './anchoredVwap';
import { rawRsi, scaleToPrice, emitCrossSignals, type SignalEvent } from './rsiOverlay';

export interface MaFvgInputs {
  showMa1: boolean; ma1Type: string; ma1Source: string; ma1Length: number;
  showMa2: boolean; ma2Type: string; ma2Source: string; ma2Length: number;
  showMa3: boolean; ma3Type: string; ma3Source: string; ma3Length: number;
  showMa4: boolean; ma4Type: string; ma4Source: string; ma4Length: number;
  showVwap: boolean; vwapAnchor: VwapAnchor; vwapSource: string; bandsMode: string;
  showBand1: boolean; bandMult1: number; showBand2: boolean; bandMult2: number; showBand3: boolean; bandMult3: number;
  showVwap1: boolean; vwap1Anchor: VwapAnchor; vwap1Source: string; showVwap1Band: boolean; vwap1BandMult: number;
  showConfluence: boolean;
  fvgThresholdPct: number; fvgAuto: boolean; fvgExtend: number;
  rsiLength: number; rsiSource: string; scaleMode: string; scaleLookback: number;
  atrLenForScale: number; atrMultForScale: number; baselineType: string; baselineLen: number;
  showSignals: boolean; signalCooldownBars: number; signalTrendFilter: boolean;
}

export const DEFAULTS: MaFvgInputs = {
  showMa1: true, ma1Type: 'SMA', ma1Source: 'close', ma1Length: 20,
  showMa2: true, ma2Type: 'SMA', ma2Source: 'close', ma2Length: 50,
  showMa3: true, ma3Type: 'SMA', ma3Source: 'close', ma3Length: 100,
  showMa4: true, ma4Type: 'SMA', ma4Source: 'close', ma4Length: 200,
  showVwap: true, vwapAnchor: 'session', vwapSource: 'hlc3', bandsMode: 'Standard Deviation',
  showBand1: true, bandMult1: 1, showBand2: false, bandMult2: 2, showBand3: false, bandMult3: 3,
  showVwap1: true, vwap1Anchor: 'week', vwap1Source: 'hlc3', showVwap1Band: true, vwap1BandMult: 1,
  showConfluence: true,
  fvgThresholdPct: 0, fvgAuto: false, fvgExtend: 20,
  rsiLength: 9, rsiSource: 'close', scaleMode: 'Range', scaleLookback: 100,
  atrLenForScale: 14, atrMultForScale: 4, baselineType: 'SMA of Source', baselineLen: 50,
  showSignals: false, signalCooldownBars: 5, signalTrendFilter: false,
};

/** MA type switch, shared by the ribbon and the MA#4 used for signals. */
export function ma(src: (number | null)[], length: number, type: string, volume: (number | null)[]): (number | null)[] {
  switch (type) {
    case 'EMA': return pm.emaPine(src, length);
    case 'SMMA (RMA)': return pm.rma(src, length);
    case 'WMA': return pm.wma(src, length);
    case 'VWMA': return pm.vwma(src, volume, length);
    case 'SMA':
    default: return pm.sma(src, length);
  }
}

export interface ScaledRsiLines {
  baseline: (number | null)[];
  scaledRsi: (number | null)[];
  scaledStrength: (number | null)[];
  scaledSignal: (number | null)[];
  /** Per-bar RSI display range (the scaling denominator) — the normalizer that
   *  converts a price gap into oscillator points for signal confidence. */
  priceRange: (number | null)[];
}

/** RSI/strength/signal scaled onto the price axis (baseline + range/ATR). */
export function scaledRsiLines(
  candles: Candle[],
  cfg: MaFvgInputs,
  computedSources?: Record<string, (number | null)[]>,
): ScaledRsiLines {
  const n = candles.length;
  const rsiSrc = resolveSourceNum(candles, cfg.rsiSource, computedSources);
  const rsi = rawRsi(rsiSrc, cfg.rsiLength);
  const strengthRsi = pm.wma(rsi, 21);
  const signalRsi = pm.emaPine(rsi, 3);
  const rangeHi = pm.highest(candles.map((c) => c.high), cfg.scaleLookback);
  const rangeLo = pm.lowest(candles.map((c) => c.low), cfg.scaleLookback);
  const atr = pm.rma(pm.tr(candles), cfg.atrLenForScale);
  const baseSma = pm.sma(rsiSrc, cfg.baselineLen);

  const baseline = new Array<number | null>(n).fill(null);
  const scaledRsi = new Array<number | null>(n).fill(null);
  const scaledStrength = new Array<number | null>(n).fill(null);
  const scaledSignal = new Array<number | null>(n).fill(null);
  const priceRangeArr = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const priceRange = cfg.scaleMode === 'ATR'
      ? (atr[i] === null ? null : atr[i]! * cfg.atrMultForScale)
      : (rangeHi[i] === null || rangeLo[i] === null ? null : rangeHi[i]! - rangeLo[i]!);
    priceRangeArr[i] = priceRange;
    const b = cfg.baselineType === 'Current Price' ? candles[i].close : baseSma[i];
    baseline[i] = b;
    if (priceRange === null || b === null || b === undefined) continue;
    if (rsi[i] !== null) scaledRsi[i] = scaleToPrice(rsi[i]!, b, priceRange);
    if (strengthRsi[i] !== null) scaledStrength[i] = scaleToPrice(strengthRsi[i]!, b, priceRange);
    if (signalRsi[i] !== null) scaledSignal[i] = scaleToPrice(signalRsi[i]!, b, priceRange);
  }
  return { baseline, scaledRsi, scaledStrength, scaledSignal, priceRange: priceRangeArr };
}

/** Freshness tiers for a signal's age (5m: 1 bar = 5 min). */
export const SIGNAL_FRESHNESS = { activeMaxBars: 5, agingMaxBars: 20 } as const;
export type SignalFreshness = 'active' | 'aging' | 'stale';

export function freshnessOf(barsAgo: number): SignalFreshness {
  if (barsAgo <= SIGNAL_FRESHNESS.activeMaxBars) return 'active';
  if (barsAgo <= SIGNAL_FRESHNESS.agingMaxBars) return 'aging';
  return 'stale';
}

/**
 * The Buy/Sell decision, standalone — same computation the composite uses for
 * its markers. Strength crosses BOTH the VWAP and MA#4, with the config's
 * cooldown + trend filter, never signalling the still-forming last bar.
 */
export function computeMaFvgSignals(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): SignalEvent[] {
  const cfg = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const volume = candles.map((c) => c.volume);
  const { scaledStrength, priceRange } = scaledRsiLines(candles, cfg, computedSources);
  const { vwap } = anchoredVwap(candles, resolveSourceNum(candles, cfg.vwapSource, computedSources), cfg.vwapAnchor);
  const ma4 = ma(resolveSourceNum(candles, cfg.ma4Source, computedSources), cfg.ma4Length, cfg.ma4Type, volume);
  const closes = candles.map((c) => c.close);
  return emitCrossSignals(scaledStrength, vwap, ma4, closes, {
    cooldownBars: cfg.signalCooldownBars,
    trendFilter: cfg.signalTrendFilter,
    end: n - 1,
    normalizer: priceRange,
  });
}
