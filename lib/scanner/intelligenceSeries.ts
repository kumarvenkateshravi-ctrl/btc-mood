// Technical Scanner — per-bar intelligence score series (Trend / Momentum /
// Volume / Context), vectorized O(n) from the SAME formulas and weights as the
// Market Context Engine (Rule 2: one source of truth — weights come from
// DEFAULT_CONTEXT_CONFIG, never re-declared here).

import type { Candle } from '../types';
import type { Series } from './types';
import * as pm from '../pineMath';
import { vdAtr } from '../indicators/vdEngine';
import { computeSuperTrend } from '../indicators/superTrend';
import { computeMacd } from '../indicators/macd';
import { computeRsi } from '../indicators/rsi';
import { computeAdx } from '../indicators/adx';
import { computeObv } from '../indicators/obv';
import { DEFAULT_CONTEXT_CONFIG } from '../context/types';
import type { IndicatorPlot } from '../indicatorFramework';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Full numeric series of one plot (line values may be {value,color}). */
export function plotSeries(plots: IndicatorPlot[], id: string): Series {
  const p = plots.find((pl) => pl.id === id);
  if (!p) return [];
  return p.data.map((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if ('value' in v) return Number.isFinite(v.value) ? v.value : null;
    return null;
  });
}

const score = (a: number | null, norm: number): number | null =>
  a == null ? null : 50 + 50 * clamp(a / norm, -1, 1);

// ---- Per-bar producer-equivalent score series (0-100, 50 = neutral) --------

export function emaScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const e9 = pm.ema(closes, 9);
  const e21 = pm.ema(closes, 21);
  const atr = vdAtr(candles);
  return Array.from({ length: n }, (_, i) => {
    const a = atr[i];
    if (e9[i] == null || e21[i] == null || a == null || a <= 0) return null;
    return score(e9[i]! - e21[i]!, a);
  });
}

export function supertrendScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const st = plotSeries(computeSuperTrend(candles).plots, 'supertrend');
  const atr = vdAtr(candles);
  return Array.from({ length: n }, (_, i) => {
    const s = st[i], a = atr[i];
    if (s == null || a == null || a <= 0) return null;
    return score(candles[i].close - s, 2 * a);
  });
}

export function macdScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const res = computeMacd(candles);
  const line = plotSeries(res.plots, 'macd');
  const hist = plotSeries(res.plots, 'hist');
  const atr = vdAtr(candles);
  return Array.from({ length: n }, (_, i) => {
    const l = line[i], h = hist[i], a = atr[i];
    if (l == null || h == null || a == null || a <= 0) return null;
    return 50 + 25 * clamp(l / (0.5 * a), -1, 1) + 25 * clamp(h / (0.25 * a), -1, 1);
  });
}

export function rsiScoreSeries(candles: Candle[]): Series {
  return plotSeries(computeRsi(candles).plots, 'rsi');
}

export function adxScoreSeries(candles: Candle[]): Series {
  const res = computeAdx(candles);
  const adx = plotSeries(res.plots, 'adx');
  const pdi = plotSeries(res.plots, 'plusDI');
  const mdi = plotSeries(res.plots, 'minusDI');
  return adx.map((a, i) => {
    const p = pdi[i], m = mdi[i];
    if (a == null || p == null || m == null) return null;
    return 50 + (p >= m ? 1 : -1) * 50 * clamp(a / 40, 0, 1);
  });
}

export function obvScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const obv = plotSeries(computeObv(candles).plots, 'obv');
  const out: Series = new Array(n).fill(null);
  let volWindow = 0;
  for (let i = 0; i < n; i++) {
    volWindow += candles[i].volume;
    if (i >= 10) volWindow -= candles[i - 10].volume;
    const now = obv[i], then = i >= 10 ? obv[i - 10] : null;
    if (i >= 20 && now != null && then != null && volWindow > 0) {
      out[i] = 50 + 50 * clamp((now - then) / volWindow, -1, 1);
    }
  }
  return out;
}

export function volumeDeltaScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const out: Series = new Array(n).fill(null);
  let delta = 0, total = 0;
  const contrib = (c: Candle) => {
    const span = c.high - c.low;
    return span > 0 ? (((c.close - c.low) - (c.high - c.close)) / span) * c.volume : 0;
  };
  for (let i = 0; i < n; i++) {
    delta += contrib(candles[i]);
    total += candles[i].volume;
    if (i >= 10) { delta -= contrib(candles[i - 10]); total -= candles[i - 10].volume; }
    if (i >= 20 && total > 0) out[i] = 50 + 50 * clamp(delta / total, -1, 1);
  }
  return out;
}

// ---- Structure + slope helpers ---------------------------------------------

/** Per-bar HH/HL structure score (0/25/50/75/100), 40-bar rolling windows. */
export function structureScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const out: Series = new Array(n).fill(null);
  for (let i = 39; i < n; i++) {
    let rH = -Infinity, rL = Infinity, pH = -Infinity, pL = Infinity;
    for (let k = i - 19; k <= i; k++) { rH = Math.max(rH, candles[k].high); rL = Math.min(rL, candles[k].low); }
    for (let k = i - 39; k <= i - 20; k++) { pH = Math.max(pH, candles[k].high); pL = Math.min(pL, candles[k].low); }
    out[i] = clamp(50 + (rH > pH ? 25 : -25) + (rL > pL ? 25 : -25), 0, 100);
  }
  return out;
}

function slopeScoreSeries(candles: Candle[], bars: number): Series {
  const n = candles.length;
  const atr = vdAtr(candles);
  return Array.from({ length: n }, (_, i) => {
    const a = atr[i];
    if (i < bars || a == null || a <= 0) return null;
    const slope = (candles[i].close - candles[i - bars].close) / (bars * a);
    return 50 + 50 * clamp(slope * 2, -1, 1);
  });
}

// ---- Blends (weights = the Context Engine's, single source of truth) -------

const blend = (parts: Array<{ s: Series; w: number }>, n: number): Series =>
  Array.from({ length: n }, (_, i) => {
    let sw = 0, acc = 0;
    for (const { s, w } of parts) {
      const v = s[i];
      if (v == null) continue;
      sw += w; acc += w * v;
    }
    return sw > 0 ? acc / sw : null;
  });

export function trendScoreSeries(candles: Candle[]): Series {
  return blend([
    { s: emaScoreSeries(candles), w: 40 },
    { s: supertrendScoreSeries(candles), w: 30 },
    { s: structureScoreSeries(candles), w: 15 },
    { s: adxScoreSeries(candles), w: 15 },
  ], candles.length);
}

export function momentumScoreSeries(candles: Candle[]): Series {
  return blend([
    { s: macdScoreSeries(candles), w: 40 },
    { s: rsiScoreSeries(candles), w: 30 },
    { s: slopeScoreSeries(candles, 10), w: 20 },
    { s: slopeScoreSeries(candles, 5), w: 10 },
  ], candles.length);
}

export function volumeScoreSeries(candles: Candle[]): Series {
  const n = candles.length;
  const volSma = pm.sma(candles.map((c) => c.volume), 20);
  const ratio: Series = Array.from({ length: n }, (_, i) => {
    const avg = volSma[i];
    if (avg == null || avg <= 0) return null;
    const dir = candles[i].close >= candles[i].open ? 1 : -1;
    return 50 + dir * 50 * clamp(candles[i].volume / avg - 1, 0, 1);
  });
  return blend([
    { s: obvScoreSeries(candles), w: 40 },
    { s: ratio, w: 30 },
    { s: volumeDeltaScoreSeries(candles), w: 20 },
  ], n);
}

/** Per-bar Context Score: the Context Engine's 7-producer blend, vectorized. */
export function contextScoreSeries(candles: Candle[]): Series {
  const w = DEFAULT_CONTEXT_CONFIG.weights;
  return blend([
    { s: emaScoreSeries(candles), w: w.ema },
    { s: supertrendScoreSeries(candles), w: w.supertrend },
    { s: macdScoreSeries(candles), w: w.macd },
    { s: rsiScoreSeries(candles), w: w.rsi },
    { s: adxScoreSeries(candles), w: w.adx },
    { s: obvScoreSeries(candles), w: w.obv },
    { s: volumeDeltaScoreSeries(candles), w: w.volume },
  ], candles.length);
}
