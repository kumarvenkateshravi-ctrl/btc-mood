// Multi-Timeframe Indicator Alignment engine — the core of the MyCryptoStack
// dashboard. For each timeframe it reduces our (golden-tested) indicators to a
// directional verdict + a 0–100 sub-score, then a per-timeframe score. Pure and
// unit-tested; the dashboard is a visualization layer on top of this.

import type { Candle, Timeframe } from './types';
import type { IndicatorPlot } from './indicatorFramework';
import * as pm from './pineMath';
import { computeRsi } from './indicators/rsi';
import { computeMacd } from './indicators/macd';
import { computeAdx } from './indicators/adx';
import { computeSuperTrend } from './indicators/superTrend';
import { computeObv } from './indicators/obv';

export type Verdict = 'bullish' | 'bearish' | 'neutral';

export type IndicatorKey = 'ema' | 'supertrend' | 'rsi' | 'macd' | 'adx' | 'obv' | 'volume';

export interface Cell {
  verdict: Verdict;
  /** 0–100 directional sub-score (100 = max bull, 0 = max bear, 50 = neutral). */
  score: number;
  /** What the table cell shows (a label or a value). */
  display: string;
}

export interface IndicatorRow {
  key: IndicatorKey;
  label: string;
  sub: string;
  /** 'label' rows show Bullish/Bearish; 'value' rows show a number/percent. */
  kind: 'label' | 'value';
  cells: Partial<Record<Timeframe, Cell>>;
}

export interface AlignmentMatrix {
  rows: IndicatorRow[];
  /** 0–100 score per timeframe (the TIMEFRAME SCORE row). */
  tfScore: Partial<Record<Timeframe, number>>;
  /** Per-timeframe directional verdict (majority of indicators). */
  tfVerdict: Partial<Record<Timeframe, Verdict>>;
  /** Per-timeframe sub-scores per indicator (for the Stack Score engine). */
  sub: Partial<Record<Timeframe, Record<IndicatorKey, number>>>;
}

const ROW_META: { key: IndicatorKey; label: string; sub: string; kind: 'label' | 'value' }[] = [
  { key: 'ema', label: 'EMA Alignment', sub: '20 > 50 > 200', kind: 'label' },
  { key: 'supertrend', label: 'Supertrend', sub: '10,3', kind: 'label' },
  { key: 'rsi', label: 'RSI', sub: '14', kind: 'value' },
  { key: 'macd', label: 'MACD', sub: '12,26,9', kind: 'label' },
  { key: 'adx', label: 'ADX', sub: '14', kind: 'value' },
  { key: 'obv', label: 'OBV', sub: 'On Balance Volume', kind: 'label' },
  { key: 'volume', label: 'Volume', sub: 'vs 20 SMA', kind: 'value' },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const verdictOf = (score: number): Verdict => (score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral');
const labelOf = (v: Verdict) => (v === 'bullish' ? 'Bullish' : v === 'bearish' ? 'Bearish' : 'Neutral');

/** Last finite value of an indicator plot's data array. */
function lastNum(data: IndicatorPlot['data']): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (d == null) continue;
    const v = typeof d === 'number' ? d : (d as { value?: number }).value;
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function plotData(plots: IndicatorPlot[], id: string): IndicatorPlot['data'] {
  return plots.find((p) => p.id === id)?.data ?? [];
}

/** Compute the seven indicator cells for one timeframe's candles. */
export function computeTfCells(candles: Candle[]): { cells: Record<IndicatorKey, Cell>; score: number; verdict: Verdict } {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;

  // EMA alignment (20 > 50 > 200).
  const e20 = lastNum(pm.emaPine(closes, 20));
  const e50 = lastNum(pm.emaPine(closes, 50));
  const e200 = lastNum(pm.emaPine(closes, 200));
  let emaScore = 50;
  if (e20 != null && e50 != null) {
    const longTerm = e200 ?? e50;
    if (e20 > e50 && e50 >= longTerm) emaScore = 100;
    else if (e20 < e50 && e50 <= longTerm) emaScore = 0;
    else emaScore = e20 > e50 ? 65 : 35;
  }

  // Supertrend: close vs the supertrend line.
  const stLine = lastNum(plotData(computeSuperTrend(candles).plots, 'supertrend'));
  const lastClose = closes[n - 1] ?? 0;
  const stScore = stLine == null ? 50 : lastClose > stLine ? 100 : 0;

  // RSI(14): the oscillator value is itself a 0–100 bull/bear reading.
  const rsi = lastNum(plotData(computeRsi(candles).plots, 'rsi'));
  const rsiScore = rsi == null ? 50 : clamp(rsi, 0, 100);

  // MACD(12,26,9): macd line vs signal line.
  const macdPlots = computeMacd(candles).plots;
  const macd = lastNum(plotData(macdPlots, 'macd'));
  const signal = lastNum(plotData(macdPlots, 'signal'));
  const macdScore = macd == null || signal == null ? 50 : macd > signal ? 100 : 0;

  // ADX(14): strength (non-directional) combined with DI direction.
  const adxPlots = computeAdx(candles).plots;
  const adx = lastNum(plotData(adxPlots, 'adx'));
  const plusDI = lastNum(plotData(adxPlots, 'plusDI'));
  const minusDI = lastNum(plotData(adxPlots, 'minusDI'));
  let adxScore = 50;
  if (adx != null && plusDI != null && minusDI != null) {
    const dir = plusDI >= minusDI ? 1 : -1;
    adxScore = 50 + dir * clamp(adx, 0, 50);
  }

  // OBV slope over ~14 bars: rising = accumulation.
  const obv = plotData(computeObv(candles).plots, 'obv');
  const obvLast = lastNum(obv);
  const obvPrevIdx = Math.max(0, obv.length - 15);
  const obvPrev = typeof obv[obvPrevIdx] === 'number' ? (obv[obvPrevIdx] as number) : null;
  const obvScore = obvLast == null || obvPrev == null ? 50 : obvLast > obvPrev ? 100 : obvLast < obvPrev ? 0 : 50;

  // Volume vs 20-period SMA → percent above/below average.
  const volSma = lastNum(pm.sma(volumes, 20));
  const lastVol = volumes[n - 1] ?? 0;
  const volPct = volSma && volSma > 0 ? (lastVol / volSma - 1) * 100 : 0;
  const volScore = clamp(50 + volPct / 2, 0, 100);

  const cells: Record<IndicatorKey, Cell> = {
    ema: { score: emaScore, verdict: verdictOf(emaScore), display: labelOf(verdictOf(emaScore)) },
    supertrend: { score: stScore, verdict: verdictOf(stScore), display: labelOf(verdictOf(stScore)) },
    rsi: { score: rsiScore, verdict: verdictOf(rsiScore), display: rsi == null ? '—' : rsi.toFixed(1) },
    macd: { score: macdScore, verdict: verdictOf(macdScore), display: labelOf(verdictOf(macdScore)) },
    adx: { score: adxScore, verdict: verdictOf(adxScore), display: adx == null ? '—' : adx.toFixed(1) },
    obv: { score: obvScore, verdict: verdictOf(obvScore), display: labelOf(verdictOf(obvScore)) },
    volume: { score: volScore, verdict: verdictOf(volScore), display: `${volPct >= 0 ? '+' : ''}${volPct.toFixed(0)}%` },
  };

  const score = Math.round(
    (cells.ema.score + cells.supertrend.score + cells.rsi.score + cells.macd.score + cells.adx.score + cells.obv.score + cells.volume.score) / 7,
  );

  return { cells, score, verdict: verdictOf(score) };
}

/** Build the full matrix across all timeframes. */
export function computeAlignmentMatrix(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  tfs: Timeframe[],
): AlignmentMatrix {
  const tfScore: AlignmentMatrix['tfScore'] = {};
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  const sub: AlignmentMatrix['sub'] = {};
  const rows: IndicatorRow[] = ROW_META.map((m) => ({ ...m, cells: {} }));

  for (const tf of tfs) {
    const candles = candlesByTf[tf];
    if (!candles || candles.length === 0) continue;
    const { cells, score, verdict } = computeTfCells(candles);
    tfScore[tf] = score;
    tfVerdict[tf] = verdict;
    sub[tf] = {
      ema: cells.ema.score, supertrend: cells.supertrend.score, rsi: cells.rsi.score,
      macd: cells.macd.score, adx: cells.adx.score, obv: cells.obv.score, volume: cells.volume.score,
    };
    for (const row of rows) row.cells[tf] = cells[row.key];
  }

  return { rows, tfScore, tfVerdict, sub };
}
