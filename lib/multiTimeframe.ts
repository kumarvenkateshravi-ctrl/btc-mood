// Multi-Timeframe intelligence engine (the spec's "source of truth"). Builds on
// the alignment matrix + golden-tested indicators to derive: consensus, the
// TF-weighted overall score, the category heatmap, per-timeframe details, market
// structure (HH/HL/LH/LL), and the short/mid/long summary. Pure + unit-tested.

import type { Candle, Timeframe } from './types';
import type { AlignmentMatrix, Verdict } from './alignment';
import * as pm from './pineMath';
import { computeRsi } from './indicators/rsi';
import { computeMacd } from './indicators/macd';
import { computeAdx } from './indicators/adx';

// Per-timeframe weights for the overall score (spec Phase 15).
export const TF_WEIGHT: Record<Timeframe, number> = {
  '5m': 0.1, '15m': 0.15, '30m': 0.15, '1h': 0.2, '4h': 0.2, '1d': 0.2,
};

const verdictOf = (score: number): Verdict => (score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral');

function lastNum(data: readonly unknown[] | null | undefined): number | null {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i];
    if (d == null) continue;
    if (typeof d === 'number') { if (Number.isFinite(d)) return d; continue; }
    if (typeof d === 'object' && 'value' in d) {
      const v = (d as { value?: number }).value;
      if (v != null && Number.isFinite(v)) return v;
    }
  }
  return null;
}
const plot = (plots: { id: string; data: unknown[] }[], id: string) => plots.find((p) => p.id === id)?.data ?? [];

// ---- Consensus (Phase 10) ----
export interface Consensus { bull: number; bear: number; neutral: number; total: number; pctBull: number; overall: Verdict; }
export function computeConsensus(matrix: AlignmentMatrix, tfs: Timeframe[]): Consensus {
  const vs = tfs.map((tf) => matrix.tfVerdict[tf]).filter(Boolean) as Verdict[];
  const bull = vs.filter((v) => v === 'bullish').length;
  const bear = vs.filter((v) => v === 'bearish').length;
  const neutral = vs.filter((v) => v === 'neutral').length;
  const total = vs.length || 1;
  return { bull, bear, neutral, total: vs.length, pctBull: Math.round((bull / total) * 100), overall: bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral' };
}

// ---- Weighted overall score (Phase 15) ----
export interface WeightedScore { overall: number; outlook: Verdict; perTf: { tf: Timeframe; weight: number; score: number }[]; }
export function computeWeightedScore(matrix: AlignmentMatrix, tfs: Timeframe[]): WeightedScore {
  let sum = 0, wsum = 0;
  const perTf: WeightedScore['perTf'] = [];
  for (const tf of tfs) {
    const score = matrix.tfScore[tf];
    if (score == null) continue;
    const weight = TF_WEIGHT[tf];
    sum += score * weight; wsum += weight;
    perTf.push({ tf, weight, score });
  }
  const overall = wsum > 0 ? Math.round(sum / wsum) : 0;
  return { overall, outlook: verdictOf(overall), perTf };
}

// ---- Heatmap (Phase 12) ----
export type HeatCategory = 'Trend' | 'Momentum' | 'Volume' | 'Strength' | 'Volatility' | 'Overall';
export interface HeatmapRow { category: HeatCategory; cells: Partial<Record<Timeframe, Verdict>>; }
export function computeHeatmap(matrix: AlignmentMatrix, candlesByTf: Partial<Record<Timeframe, Candle[]>>, tfs: Timeframe[]): HeatmapRow[] {
  const rows: HeatmapRow[] = (['Trend', 'Momentum', 'Volume', 'Strength', 'Volatility', 'Overall'] as HeatCategory[]).map((category) => ({ category, cells: {} }));
  for (const tf of tfs) {
    const sub = matrix.sub[tf];
    if (!sub) continue;
    rows[0].cells[tf] = verdictOf(sub.ema);
    rows[1].cells[tf] = verdictOf((sub.rsi + sub.macd) / 2);
    rows[2].cells[tf] = verdictOf((sub.volume + sub.obv) / 2);
    rows[3].cells[tf] = verdictOf(sub.adx);
    rows[4].cells[tf] = volatilityVerdict(candlesByTf[tf]);
    rows[5].cells[tf] = matrix.tfVerdict[tf];
  }
  return rows;
}
/** Calm (low ATR%) reads green, elevated reads red — a risk colouring. */
function volatilityVerdict(candles: Candle[] | undefined): Verdict {
  if (!candles || candles.length < 20) return 'neutral';
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atr = lastNum(pm.rma(pm.tr(candles.map((c, i) => ({ high: highs[i], low: lows[i], close: closes[i] }))), 14));
  const close = closes[closes.length - 1] ?? 0;
  if (atr == null || close === 0) return 'neutral';
  const pct = (atr / close) * 100;
  return pct < 0.5 ? 'bullish' : pct > 1.2 ? 'bearish' : 'neutral';
}

// ---- Timeframe details (Phase 13) ----
export interface TimeframeDetails {
  trend: { ema20: number | null; ema50: number | null; ema200: number | null; verdict: Verdict };
  momentum: { rsi: number | null; macd: number | null; signal: number | null; histogram: number | null; verdict: Verdict };
  strength: { adx: number | null; diPlus: number | null; diMinus: number | null; verdict: Verdict };
  volume: { current: number | null; sma20: number | null; vsPct: number | null; verdict: Verdict };
}
export function computeTimeframeDetails(candles: Candle[]): TimeframeDetails {
  const closes = candles.map((c) => c.close), volumes = candles.map((c) => c.volume);
  const ema20 = lastNum(pm.emaPine(closes, 20)), ema50 = lastNum(pm.emaPine(closes, 50)), ema200 = lastNum(pm.emaPine(closes, 200));
  const trendV: Verdict = ema20 != null && ema50 != null ? (ema20 > ema50 && ema50 >= (ema200 ?? ema50) ? 'bullish' : ema20 < ema50 && ema50 <= (ema200 ?? ema50) ? 'bearish' : 'neutral') : 'neutral';

  const macdP = computeMacd(candles).plots as { id: string; data: unknown[] }[];
  const rsi = lastNum(plot(computeRsi(candles).plots as { id: string; data: unknown[] }[], 'rsi'));
  const macd = lastNum(plot(macdP, 'macd')), signal = lastNum(plot(macdP, 'signal')), histogram = lastNum(plot(macdP, 'hist'));
  const momV: Verdict = rsi != null ? (rsi > 55 && (macd ?? 0) > (signal ?? 0) ? 'bullish' : rsi < 45 && (macd ?? 0) < (signal ?? 0) ? 'bearish' : 'neutral') : 'neutral';

  const adxP = computeAdx(candles).plots as { id: string; data: unknown[] }[];
  const adx = lastNum(plot(adxP, 'adx')), diPlus = lastNum(plot(adxP, 'plusDI')), diMinus = lastNum(plot(adxP, 'minusDI'));
  const strV: Verdict = adx != null && adx >= 25 && diPlus != null && diMinus != null ? (diPlus >= diMinus ? 'bullish' : 'bearish') : 'neutral';

  const current = volumes[volumes.length - 1] ?? null;
  const sma20 = lastNum(pm.sma(volumes, 20));
  const vsPct = sma20 && sma20 > 0 && current != null ? (current / sma20 - 1) * 100 : null;
  const volV: Verdict = vsPct == null ? 'neutral' : vsPct > 5 ? 'bullish' : vsPct < -5 ? 'bearish' : 'neutral';

  return {
    trend: { ema20, ema50, ema200, verdict: trendV },
    momentum: { rsi, macd, signal, histogram, verdict: momV },
    strength: { adx, diPlus, diMinus, verdict: strV },
    volume: { current, sma20, vsPct, verdict: volV },
  };
}

// ---- Market structure (Phase 14) ----
export interface MarketStructure { label: string; sublabel: string; verdict: Verdict; }
export function detectStructure(candles: Candle[]): MarketStructure {
  const n = candles.length;
  if (n < 20) return { label: 'Range', sublabel: 'Insufficient data', verdict: 'neutral' };
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low);
  const ph = pm.pivotHigh(highs, 3, 3), pl = pm.pivotLow(lows, 3, 3);
  const phVals: number[] = [], plVals: number[] = [];
  for (let i = 0; i < n; i++) { if (ph[i] != null) phVals.push(ph[i] as number); if (pl[i] != null) plVals.push(pl[i] as number); }
  const h = phVals.slice(-2), l = plVals.slice(-2);
  const hh = h.length === 2 && h[1] > h[0], hl = l.length === 2 && l[1] > l[0];
  const lh = h.length === 2 && h[1] < h[0], ll = l.length === 2 && l[1] < l[0];
  if (hh && hl) return { label: 'Bull Trend', sublabel: 'Higher Highs / Higher Lows', verdict: 'bullish' };
  if (lh && ll) return { label: 'Bear Trend', sublabel: 'Lower Highs / Lower Lows', verdict: 'bearish' };
  return { label: 'Range', sublabel: 'Mixed structure', verdict: 'neutral' };
}

// ---- Summary (Phase 16) ----
export interface SummaryBand { label: string; verdict: Verdict; }
export interface Summary { shortTerm: SummaryBand; midTerm: SummaryBand; longTerm: SummaryBand; outlook: SummaryBand; }
function bandLabel(avg: number): SummaryBand {
  if (avg >= 65) return { label: 'Strong Bullish', verdict: 'bullish' };
  if (avg >= 55) return { label: 'Bullish', verdict: 'bullish' };
  if (avg >= 45) return { label: 'Weak & Choppy', verdict: 'neutral' };
  if (avg >= 35) return { label: 'Bearish Pressure', verdict: 'bearish' };
  if (avg >= 25) return { label: 'Strong Bearish', verdict: 'bearish' };
  return { label: 'Heavy Bearish', verdict: 'bearish' };
}
const meanScore = (matrix: AlignmentMatrix, tfs: Timeframe[]) => {
  const xs = tfs.map((tf) => matrix.tfScore[tf]).filter((s): s is number => s != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50;
};
export function buildSummary(matrix: AlignmentMatrix, weighted: WeightedScore): Summary {
  const shortTerm = bandLabel(meanScore(matrix, ['5m', '15m']));
  const midTerm = bandLabel(meanScore(matrix, ['30m', '1h']));
  const longTerm = bandLabel(meanScore(matrix, ['4h', '1d']));
  const outlook = bandLabel(weighted.overall);
  // Outlook keeps a clean Bullish/Bearish/Neutral label, not a band phrase.
  outlook.label = weighted.outlook === 'bullish' ? 'Bullish' : weighted.outlook === 'bearish' ? 'Bearish' : 'Neutral';
  return { shortTerm, midTerm, longTerm, outlook };
}
