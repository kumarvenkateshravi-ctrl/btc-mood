// "Moving Averages & FVG" — composite overlay indicator. Assembles five feature
// blocks from the unit-tested helpers in this folder: MA ribbon, VWAP(+bands) &
// VWAP-1, MA+VWAP confluence markers, LuxAlgo Fair Value Gap boxes, and a
// price-scaled RSI overlay with Buy/Sell signals.
// Port of MA-FVG-Tune.pine — see docs/superpowers/specs/2026-07-20-ma-fvg-indicator-design.md
// FVG module: LuxAlgo, CC BY-NC-SA 4.0 (NonCommercial).

import type { Candle } from '../../types';
import type {
  IndicatorResult, IndicatorPlot, IndicatorMarker, SignalSide, CustomIndicatorConfig,
  CandleColorOverride,
} from '../../indicatorFramework';
import { neutralSignals, resolveInputs, resolveSourceNum } from '../itsTemplates';
import { anchoredVwap } from './anchoredVwap';
import { detectFvgs } from './fvg';
import { emitCrossSignals } from './rsiOverlay';
import { DEFAULTS, ma, scaledRsiLines, type MaFvgInputs } from './signals';

export type { MaFvgInputs };

const MA_COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f60c0c'];

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
  // Always compute the primary VWAP — needed for confluence detection even
  // when the VWAP line is hidden (showVwap = false).
  const vwapSrc = resolveSourceNum(candles, cfg.vwapSource, computedSources);
  const { vwap: vwapData, sd: vwapSd } = anchoredVwap(candles, vwapSrc, cfg.vwapAnchor);
  const vwapArr = vwapData; // always available for confluence + signal generation

  if (cfg.showVwap) {
    plots.push(line('vwap', 'VWAP', '#2962FF', vwapData, 2));
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
        const v = vwapData[i]; const s = vwapSd[i];
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

  // ── MA + VWAP confluence → yellow candle body highlight ────
  // Detect bars where MA1, MA2 and the main VWAP all pass through the candle.
  // Detection uses the computed values regardless of whether those lines are
  // currently visible — the user may hide the lines but still want the alert.
  // Body color comes from the 'confluenceCandle' style entry (user-configurable).
  // Wick and border are always directional: green for bullish, red for bearish.
  const DEFAULT_CONFLUENCE_BODY = 'rgba(255, 215, 0, 0.85)';
  const BULL_WICK = '#26a69a';
  const BEAR_WICK = '#ef5350';
  const confluenceBody: (string | null)[] = new Array(n).fill(null);
  const confluenceWick: (string | null)[] = new Array(n).fill(null);
  if (cfg.showConfluence) {
    for (let i = 0; i < lastConfirmed; i++) {
      const c = candles[i];
      const m1 = maLines[0][i]; const m2 = maLines[1][i]; const v = vwapArr[i];
      const touch = (x: number | null) => x !== null && c.low <= x && c.high >= x;
      if (touch(m1) && touch(m2) && touch(v)) {
        confluenceBody[i] = DEFAULT_CONFLUENCE_BODY;
        confluenceWick[i] = c.close >= c.open ? BULL_WICK : BEAR_WICK;
      }
    }
  }

  // ── Fair Value Gaps ────────────────────────────────────────
  // The Pine deletes a gap's box on mitigation, so only UNMITIGATED gaps show.
  // Each open gap is a flat box from formation-2 to formation+extend.
  const fvg = detectFvgs(candles, { thresholdPct: cfg.fvgThresholdPct, auto: cfg.fvgAuto });
  fvg.fvgs.filter((g) => g.endIndex === null).forEach((g, k) => {
    const left = Math.max(0, g.startIndex - 2);
    const right = Math.min(n - 1, g.startIndex + cfg.fvgExtend);
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
  const { baseline: baselineArr, scaledRsi, scaledStrength, scaledSignal } =
    scaledRsiLines(candles, cfg, computedSources);
  // RSI fill (the Pine's fill(p_rsi, h_50, ...)): ONE band between the scaled RSI
  // line (upper) and the baseline (lower), drawn two-tone — teal where RSI > 50
  // (scaled line above baseline), red where < 50 — and split at the EXACT
  // interpolated crossing so the colours meet on the line with no notch or seam.
  // Pushed BEFORE the lines so it renders behind them.
  const rsiFill = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const s = scaledRsi[i]; const b = baselineArr[i];
    if (s === null || b === null) continue;
    rsiFill[i] = { upper: s, lower: b };
  }
  plots.push({
    id: 'rsiFill', title: 'RSI Fill', color: 'rgba(38, 166, 154, 0.20)',
    type: 'band', pane: 'overlay', areaFill: true,
    areaFillColors: { above: 'rgba(38, 166, 154, 0.20)', below: 'rgba(242, 54, 69, 0.20)' },
    data: rsiFill,
  });
  plots.push(line('rsiBaseline', 'Baseline (50)', 'rgba(120, 124, 139, 0.5)', baselineArr, 1));
  plots.push(line('rsiLine', 'RSI (scaled)', '#b388ff', scaledRsi, 2));
  plots.push(line('rsiStrength', 'Strength (WMA)', '#ff9800', scaledStrength, 2));
  plots.push(line('rsiSignal', 'Signal (EMA)', '#00b0ff', scaledSignal, 2));

  // ── Signals ───────────────────────────────────────────────
  // Strength crosses BOTH the VWAP and MA #4 (price space), with optional
  // cooldown + trend filter to cut whipsaws. Confidence rides on the marker.
  if (cfg.showSignals) {
    const closes = candles.map((c) => c.close);
    const events = emitCrossSignals(scaledStrength, vwapArr, maLines[3], closes, {
      cooldownBars: cfg.signalCooldownBars,
      trendFilter: cfg.signalTrendFilter,
      end: lastConfirmed, // never signal the still-forming bar
    });
    for (const ev of events) {
      signals[ev.index] = ev.side;
      markers.push(ev.side === 'buy'
        ? { index: ev.index, position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: 'BUY', value: ev.confidence }
        : { index: ev.index, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: 'SELL', value: ev.confidence });
    }
  }

  const candleColors: CandleColorOverride | undefined = cfg.showConfluence ? {
    styleId: 'confluenceCandle',
    color: confluenceBody,
    wickColor: confluenceWick,
    borderColor: confluenceWick,
  } : undefined;

  return { plots, signals, markers, candleColors };
}
