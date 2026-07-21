// "Moving Averages & FVG" — composite overlay indicator. Assembles five feature
// blocks from the unit-tested helpers in this folder: MA ribbon, VWAP(+bands) &
// VWAP-1, MA+VWAP confluence markers, LuxAlgo Fair Value Gap boxes, and a
// price-scaled RSI overlay with Buy/Sell signals.
// Port of MA-FVG-Tune.pine — see docs/superpowers/specs/2026-07-20-ma-fvg-indicator-design.md
// FVG module: LuxAlgo, CC BY-NC-SA 4.0 (NonCommercial).

import type { Candle } from '../../types';
import type {
  IndicatorResult, IndicatorPlot, IndicatorMarker, SignalSide, CustomIndicatorConfig,
} from '../../indicatorFramework';
import * as pm from '../../pineMath';
import { neutralSignals, resolveInputs, resolveSourceNum } from '../itsTemplates';
import type { VwapAnchor } from '../vwapAnchor';
import { anchoredVwap } from './anchoredVwap';
import { detectFvgs } from './fvg';
import { rawRsi, scaleToPrice, crossSignals } from './rsiOverlay';

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
  showSignals: boolean;
}

const DEFAULTS: MaFvgInputs = {
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
  showSignals: true,
};

const MA_COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f60c0c'];

function ma(src: (number | null)[], length: number, type: string, volume: (number | null)[]): (number | null)[] {
  switch (type) {
    case 'EMA': return pm.emaPine(src, length);
    case 'SMMA (RMA)': return pm.rma(src, length);
    case 'WMA': return pm.wma(src, length);
    case 'VWMA': return pm.vwma(src, volume, length);
    case 'SMA':
    default: return pm.sma(src, length);
  }
}

const line = (id: string, title: string, color: string, data: (number | null)[], width = 1): IndicatorPlot =>
  ({ id, title, color, type: 'line', pane: 'overlay', lineWidth: width, data });

export function computeMaFvg(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  computedSources?: Record<string, (number | null)[]>,
): IndicatorResult {
  const cfg = resolveInputs(config, DEFAULTS);
  const n = candles.length;
  const volume = candles.map((c) => c.volume);
  const plots: IndicatorPlot[] = [];
  const markers: IndicatorMarker[] = [];
  const signals: SignalSide[] = neutralSignals(n);
  const lastConfirmed = n - 1; // the final bar is still forming — no markers/signals there.

  // ── MA ribbon ──────────────────────────────────────────────
  const maSpecs = [
    { show: cfg.showMa1, type: cfg.ma1Type, source: cfg.ma1Source, length: cfg.ma1Length },
    { show: cfg.showMa2, type: cfg.ma2Type, source: cfg.ma2Source, length: cfg.ma2Length },
    { show: cfg.showMa3, type: cfg.ma3Type, source: cfg.ma3Source, length: cfg.ma3Length },
    { show: cfg.showMa4, type: cfg.ma4Type, source: cfg.ma4Source, length: cfg.ma4Length },
  ];
  const maLines = maSpecs.map((s) =>
    ma(resolveSourceNum(candles, s.source, computedSources), s.length, s.type, volume));
  maSpecs.forEach((s, k) => {
    if (s.show) plots.push(line(`ma_${k + 1}`, `MA #${k + 1}`, MA_COLORS[k], maLines[k], 1));
  });

  // ── VWAP + bands ───────────────────────────────────────────
  let vwapArr: (number | null)[] = new Array(n).fill(null);
  if (cfg.showVwap) {
    const src = resolveSourceNum(candles, cfg.vwapSource, computedSources);
    const { vwap, sd } = anchoredVwap(candles, src, cfg.vwapAnchor);
    vwapArr = vwap;
    plots.push(line('vwap', 'VWAP', '#2962FF', vwap, 2));
    const bandSpecs = [
      { show: cfg.showBand1, mult: cfg.bandMult1, color: '#26a69a' },
      { show: cfg.showBand2, mult: cfg.bandMult2, color: '#808000' },
      { show: cfg.showBand3, mult: cfg.bandMult3, color: '#008080' },
    ];
    bandSpecs.forEach((b, k) => {
      if (!b.show) return;
      const u = new Array<number | null>(n).fill(null);
      const l = new Array<number | null>(n).fill(null);
      for (let i = 0; i < n; i++) {
        const v = vwap[i]; const s = sd[i];
        if (v === null || s === null) continue;
        const basis = cfg.bandsMode === 'Percentage' ? v * 0.01 : s;
        u[i] = v + b.mult * basis; l[i] = v - b.mult * basis;
      }
      plots.push(line(`vwapU${k + 1}`, `VWAP +${b.mult}σ`, b.color, u, 1));
      plots.push(line(`vwapL${k + 1}`, `VWAP -${b.mult}σ`, b.color, l, 1));
    });
  }

  // ── VWAP-1 (independent, not part of confluence) ───────────
  if (cfg.showVwap1) {
    const src = resolveSourceNum(candles, cfg.vwap1Source, computedSources);
    const { vwap, sd } = anchoredVwap(candles, src, cfg.vwap1Anchor);
    plots.push(line('vwap1', 'VWAP-1', '#e91e63', vwap, 2));
    if (cfg.showVwap1Band) {
      const u = new Array<number | null>(n).fill(null);
      const l = new Array<number | null>(n).fill(null);
      for (let i = 0; i < n; i++) {
        const v = vwap[i]; const s = sd[i];
        if (v === null || s === null) continue;
        const basis = cfg.bandsMode === 'Percentage' ? v * 0.01 : s;
        u[i] = v + cfg.vwap1BandMult * basis; l[i] = v - cfg.vwap1BandMult * basis;
      }
      plots.push(line('vwap1U1', `VWAP-1 +${cfg.vwap1BandMult}σ`, '#9c27b0', u, 1));
      plots.push(line('vwap1L1', `VWAP-1 -${cfg.vwap1BandMult}σ`, '#9c27b0', l, 1));
    }
  }

  // ── MA + VWAP confluence (MA1, MA2, main VWAP only) ────────
  if (cfg.showConfluence && cfg.showVwap) {
    for (let i = 0; i < lastConfirmed; i++) {
      const c = candles[i];
      const m1 = maLines[0][i]; const m2 = maLines[1][i]; const v = vwapArr[i];
      const touch = (x: number | null) => x !== null && c.low <= x && c.high >= x;
      if (touch(m1) && touch(m2) && touch(v)) {
        markers.push({ index: i, position: 'inBar', color: '#2962FF', shape: 'circle', text: 'C' });
      }
    }
  }

  // ── Fair Value Gaps (boxes as band plots) ──────────────────
  const fvg = detectFvgs(candles, { thresholdPct: cfg.fvgThresholdPct, auto: cfg.fvgAuto });
  fvg.fvgs.forEach((g, k) => {
    const left = Math.max(0, g.startIndex - 2);
    const right = Math.min(n - 1, g.endIndex ?? g.startIndex + cfg.fvgExtend);
    const data = new Array<{ upper: number; lower: number } | null>(n).fill(null);
    for (let i = left; i <= right; i++) data[i] = { upper: g.top, lower: g.bottom };
    plots.push({
      id: `fvg_${g.isBull ? 'bull' : 'bear'}_${k}`,
      title: 'FVG',
      color: g.isBull ? 'rgba(8,153,129,0.3)' : 'rgba(242,54,69,0.3)',
      type: 'band', pane: 'overlay', data,
    });
  });

  // ── RSI overlay + Buy/Sell signals ─────────────────────────
  const rsiSrc = resolveSourceNum(candles, cfg.rsiSource, computedSources);
  const rsi = rawRsi(rsiSrc, cfg.rsiLength);
  const strengthRsi = pm.wma(rsi, 21);
  const signalRsi = pm.emaPine(rsi, 3);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rangeHi = pm.highest(highs, cfg.scaleLookback);
  const rangeLo = pm.lowest(lows, cfg.scaleLookback);
  const atr = pm.rma(pm.tr(candles), cfg.atrLenForScale);
  const baseSma = pm.sma(rsiSrc, cfg.baselineLen);

  const baselineArr = new Array<number | null>(n).fill(null);
  const scaledRsi = new Array<number | null>(n).fill(null);
  const scaledStrength = new Array<number | null>(n).fill(null);
  const scaledSignal = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const priceRange = cfg.scaleMode === 'ATR'
      ? (atr[i] === null ? null : atr[i]! * cfg.atrMultForScale)
      : (rangeHi[i] === null || rangeLo[i] === null ? null : rangeHi[i]! - rangeLo[i]!);
    const baseline = cfg.baselineType === 'Current Price' ? candles[i].close : baseSma[i];
    baselineArr[i] = baseline;
    if (priceRange === null || baseline === null || baseline === undefined) continue;
    if (rsi[i] !== null) scaledRsi[i] = scaleToPrice(rsi[i]!, baseline, priceRange);
    if (strengthRsi[i] !== null) scaledStrength[i] = scaleToPrice(strengthRsi[i]!, baseline, priceRange);
    if (signalRsi[i] !== null) scaledSignal[i] = scaleToPrice(signalRsi[i]!, baseline, priceRange);
  }
  plots.push(line('rsiBaseline', 'Baseline (50)', '#4caf50', baselineArr, 1));
  plots.push(line('rsiLine', 'RSI (scaled)', '#000000', scaledRsi, 2));
  plots.push(line('rsiStrength', 'Strength (WMA)', '#f23645', scaledStrength, 2));
  plots.push(line('rsiSignal', 'Signal (EMA)', '#4caf50', scaledSignal, 2));

  if (cfg.showSignals) {
    // Strength crosses BOTH the VWAP and MA #4 (in price space), per the Pine.
    const { buy, sell } = crossSignals(scaledStrength, vwapArr, maLines[3]);
    for (let i = 0; i < lastConfirmed; i++) {
      if (buy[i]) {
        signals[i] = 'buy';
        markers.push({ index: i, position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: 'BUY' });
      } else if (sell[i]) {
        signals[i] = 'sell';
        markers.push({ index: i, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: 'SELL' });
      }
    }
  }

  return { plots, signals, markers };
}
