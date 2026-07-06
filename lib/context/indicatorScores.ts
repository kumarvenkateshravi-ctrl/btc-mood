// Market Context Engine — the fixed indicator roster (revisedMTF: independent
// of chart toggles), each adapted to a 0-100 directional ContextIndicatorScore.
// REUSES the existing indicator engines (no recalculation): pineMath EMA, the
// SuperTrend/MACD/RSI/ADX/OBV compute functions, and vdEngine's ATR.
// Callers pass CLOSED bars only.

import type { Timeframe } from '../types';
import type { IndicatorPlot } from '../indicatorFramework';
import * as pm from '../pineMath';
import { vdAtr } from '../indicators/vdEngine';
import { computeSuperTrend } from '../indicators/superTrend';
import { computeMacd } from '../indicators/macd';
import { computeRsi } from '../indicators/rsi';
import { computeAdx } from '../indicators/adx';
import { computeObv } from '../indicators/obv';
import { clamp, clamp01 } from './scoringEngine';
import type { ContextIndicatorScore, ContextScoreProducer, ContextWeights, ContextState } from './types';

const stateOf = (score: number): ContextState =>
  score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral';

const mk = (
  name: string, tf: Timeframe, score: number, confidence: number, explanation: string,
): ContextIndicatorScore => ({
  name, timeframe: tf,
  score: clamp(Math.round(score * 10) / 10, 0, 100),
  state: stateOf(score),
  confidence: clamp01(confidence),
  explanation,
});

/** Last non-null numeric value of a plot (line data may be {value,color}). */
function lastNum(plot: IndicatorPlot | undefined, at?: number): number | null {
  if (!plot) return null;
  for (let i = Math.min(at ?? plot.data.length - 1, plot.data.length - 1); i >= 0; i--) {
    const v = plot.data[i];
    if (v == null) continue;
    if (typeof v === 'number') return v;
    if ('value' in v && Number.isFinite(v.value)) return v.value;
  }
  return null;
}

const plotOf = (plots: IndicatorPlot[], id: string): IndicatorPlot | undefined =>
  plots.find((p) => p.id === id);

// ---- Producers -------------------------------------------------------------

export const emaAlignScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 50);
  if (n < 22) return mk('ema', tf, 50, conf, 'EMA warm-up');
  const closes = candles.map((c) => c.close);
  const e9 = pm.ema(closes, 9)[n - 1];
  const e21 = pm.ema(closes, 21)[n - 1];
  const a = vdAtr(candles)[n - 1] ?? 0;
  if (e9 == null || e21 == null || a <= 0) return mk('ema', tf, 50, conf, 'EMA unavailable');
  const gap = clamp((e9 - e21) / a, -1, 1);
  return mk('ema', tf, 50 + 50 * gap, conf,
    `EMA9 ${e9 > e21 ? '>' : '<'} EMA21 by ${(Math.abs(e9 - e21)).toFixed(1)} (${Math.abs(gap).toFixed(2)}×ATR)`);
};

export const supertrendScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 30);
  if (n < 15) return mk('supertrend', tf, 50, conf, 'Supertrend warm-up');
  const res = computeSuperTrend(candles);
  const st = lastNum(plotOf(res.plots, 'supertrend'));
  const a = vdAtr(candles)[n - 1] ?? 0;
  const close = candles[n - 1].close;
  if (st == null || a <= 0) return mk('supertrend', tf, 50, conf, 'Supertrend unavailable');
  const mag = clamp(Math.abs(close - st) / (2 * a), 0, 1);
  const score = close >= st ? 50 + 50 * mag : 50 - 50 * mag;
  return mk('supertrend', tf, score, conf,
    `Price ${close >= st ? 'above' : 'below'} Supertrend (${st.toFixed(1)})`);
};

export const macdScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 60);
  if (n < 35) return mk('macd', tf, 50, conf, 'MACD warm-up');
  const res = computeMacd(candles);
  const line = lastNum(plotOf(res.plots, 'macd'));
  const hist = lastNum(plotOf(res.plots, 'hist'));
  const a = vdAtr(candles)[n - 1] ?? 0;
  if (line == null || hist == null || a <= 0) return mk('macd', tf, 50, conf, 'MACD unavailable');
  // Line vs zero = trend direction; histogram = momentum change. A steady
  // trend has hist≈0 but a strongly signed line — both must contribute.
  const lineN = clamp(line / (0.5 * a), -1, 1);
  const histN = clamp(hist / (0.25 * a), -1, 1);
  return mk('macd', tf, 50 + 25 * lineN + 25 * histN, conf,
    `MACD ${line >= 0 ? 'above' : 'below'} zero, histogram ${hist >= 0 ? '+' : ''}${hist.toFixed(2)}`);
};

export const rsiScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 30);
  if (n < 16) return mk('rsi', tf, 50, conf, 'RSI warm-up');
  const rsi = lastNum(plotOf(computeRsi(candles).plots, 'rsi'));
  if (rsi == null) return mk('rsi', tf, 50, conf, 'RSI unavailable');
  const note = rsi >= 70 ? ' (overbought)' : rsi <= 30 ? ' (oversold)' : '';
  return mk('rsi', tf, rsi, conf, `RSI ${rsi.toFixed(0)}${note}`);
};

export const adxScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 40);
  if (n < 30) return mk('adx', tf, 50, conf, 'ADX warm-up');
  const res = computeAdx(candles);
  const adx = lastNum(plotOf(res.plots, 'adx'));
  const pdi = lastNum(plotOf(res.plots, 'plusDI'));
  const mdi = lastNum(plotOf(res.plots, 'minusDI'));
  if (adx == null || pdi == null || mdi == null) return mk('adx', tf, 50, conf, 'ADX unavailable');
  const dir = pdi >= mdi ? 1 : -1;
  const strength = clamp(adx / 40, 0, 1);
  return mk('adx', tf, 50 + dir * 50 * strength, conf,
    `ADX ${adx.toFixed(0)} ${adx >= 25 ? 'strong' : 'weak'}, DI${dir > 0 ? '+' : '−'} leading`);
};

export const obvScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 30);
  if (n < 21) return mk('obv', tf, 50, conf, 'OBV warm-up');
  const obvPlot = plotOf(computeObv(candles).plots, 'obv');
  const now = lastNum(obvPlot, n - 1);
  const then = lastNum(obvPlot, n - 11);
  if (now == null || then == null) return mk('obv', tf, 50, conf, 'OBV unavailable');
  // Normalize the 10-bar OBV change by the total volume over the same window.
  let volWindow = 0;
  for (let i = Math.max(0, n - 10); i < n; i++) volWindow += candles[i].volume;
  const slope = volWindow > 0 ? clamp((now - then) / volWindow, -1, 1) : 0;
  return mk('obv', tf, 50 + 50 * slope, conf,
    `OBV ${slope >= 0 ? 'rising' : 'falling'} over 10 bars`);
};

export const volumeScore: ContextScoreProducer = (candles, tf) => {
  const n = candles.length;
  const conf = clamp01(n / 30);
  if (n < 21) return mk('volume', tf, 50, conf, 'Volume warm-up');
  // Buy/sell delta estimator over the last 10 bars (close position in range).
  let delta = 0;
  let total = 0;
  for (let i = Math.max(0, n - 10); i < n; i++) {
    const c = candles[i];
    const span = c.high - c.low;
    const frac = span > 0 ? ((c.close - c.low) - (c.high - c.close)) / span : 0;
    delta += frac * c.volume;
    total += c.volume;
  }
  const d = total > 0 ? clamp(delta / total, -1, 1) : 0;
  const smaVol = pm.sma(candles.map((c) => c.volume), 20)[n - 1];
  const ratio = smaVol != null && smaVol > 0 ? candles[n - 1].volume / smaVol : 1;
  return mk('volume', tf, 50 + 50 * d, conf,
    `Volume delta ${d >= 0 ? 'buy' : 'sell'}-side ${(Math.abs(d) * 100).toFixed(0)}%, last bar ${ratio.toFixed(1)}× avg`);
};

/** The fixed roster (refinement 12: extend by adding entries — nothing else changes). */
export const CONTEXT_PRODUCERS: Record<keyof ContextWeights, ContextScoreProducer> = {
  ema: emaAlignScore,
  supertrend: supertrendScore,
  macd: macdScore,
  rsi: rsiScore,
  adx: adxScore,
  obv: obvScore,
  volume: volumeScore,
};
