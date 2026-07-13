// D Smart-style adaptive cloud (see docs/superpowers/plans/2026-07-12-dsmart-line.md).
//
// A faithful-in-spirit reconstruction of Definedge's D Smart Line — the
// formulas below are OURS (Definedge publishes none): an adaptive trailing
// pair whose offsets contract during clean directional runs (aggressive) and
// expand when direction flips cluster (slow), computed identically on candles
// or Renko bricks. When the chart is in Renko mode the pipeline feeds bricks
// in as Candle[], which is exactly the article's "same formula, brick inputs"
// construction.
//
//  - Walking Line: ratcheting trail (never moves against its regime). Price
//    closing across it flips the regime. The stop-loss line.
//  - Running Line: same construction, smaller offset, shorter adaptation
//    window, and NO ratchet — hugs price and flips early.
//  - Cloud: between the two lines; width (in brick units) reads consolidation.
//  - Events: arrow (Donchian continuation), P (pullback resumption), star
//    (direction flip while the Disparity Index is stretched).

import type { Candle } from '../types';

export interface DsmartConfig {
  /** Base trail offset in brick units. */
  kBase: number;
  kMin: number;
  kMax: number;
  /** Offset widening per direction flip in the adaptation window. */
  lambda: number;
  /** Offset tightening per bar of the current run (capped at runCap). */
  mu: number;
  runCap: number;
  /** Adaptation windows (bars) for the Walking / Running lines. */
  wWalk: number;
  wRun: number;
  /** Running offset = Walking offset x this ratio (< 1 = more aggressive). */
  kRunRatio: number;
  /** Donchian lookback for continuation arrows. */
  donchianLen: number;
  /** Disparity Index: SMA length and trigger threshold (0.03 = 3%). */
  dispLen: number;
  dispThreshold: number;
  /** Longest counter-trend run that still counts as a pullback (P). */
  maxPullbackLen: number;
}

export const DSMART_DEFAULTS: DsmartConfig = {
  kBase: 2,
  kMin: 1,
  kMax: 4,
  lambda: 0.4,
  mu: 0.25,
  runCap: 8,
  wWalk: 20,
  wRun: 8,
  kRunRatio: 0.5,
  donchianLen: 10,
  dispLen: 20,
  dispThreshold: 0.03,
  maxPullbackLen: 3,
};

export type DsmartEventType = 'arrow' | 'pullback' | 'star';

export interface DsmartEvent {
  type: DsmartEventType;
  /** Trade direction the event supports (star = the side being warned OF). */
  direction: 'bullish' | 'bearish';
  barIndex: number;
}

export interface DsmartResult {
  /** Walking Line per bar (null during warmup). */
  walk: Array<number | null>;
  /** Running Line per bar. */
  run: Array<number | null>;
  /** Walking-line regime: 1 bullish, -1 bearish, 0 warmup. */
  regime: Array<1 | -1 | 0>;
  /** |run - walk| in brick units (consolidation gauge). */
  cloudWidth: Array<number | null>;
  events: DsmartEvent[];
  /** Brick-unit scale used at the last bar (for tooltips/tests). */
  brickUnit: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeDsmart(candles: Candle[], cfg: DsmartConfig = DSMART_DEFAULTS): DsmartResult {
  const n = candles.length;
  const walk: Array<number | null> = new Array(n).fill(null);
  const run: Array<number | null> = new Array(n).fill(null);
  const regime: Array<1 | -1 | 0> = new Array(n).fill(0);
  const cloudWidth: Array<number | null> = new Array(n).fill(null);
  const events: DsmartEvent[] = [];
  if (n === 0) return { walk, run, regime, cloudWidth, events, brickUnit: 0 };

  // ---- per-bar direction, runs, flips ---------------------------------------
  const dir: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const body = candles[i].close - candles[i].open;
    dir[i] = body > 0 ? 1 : body < 0 ? -1
      : i > 0 ? (candles[i].close > candles[i - 1].close ? 1 : candles[i].close < candles[i - 1].close ? -1 : dir[i - 1]) : 0;
  }
  const runLen: number[] = new Array(n).fill(1);
  for (let i = 1; i < n; i++) runLen[i] = dir[i] !== 0 && dir[i] === dir[i - 1] ? runLen[i - 1] + 1 : 1;

  const flipsIn = (i: number, w: number): number => {
    let f = 0;
    for (let j = Math.max(1, i - w + 1); j <= i; j++) if (dir[j] !== 0 && dir[j - 1] !== 0 && dir[j] !== dir[j - 1]) f++;
    return f;
  };

  // ---- brick unit: rolling median |body| over 50 bars ------------------------
  // On Renko every body is exactly the brick size; on candles it is a robust
  // body scale. Zero bodies (dojis) are excluded so chop cannot zero the unit.
  const bodySize = (i: number) => Math.abs(candles[i].close - candles[i].open);
  const brickAt = (i: number): number => {
    const from = Math.max(0, i - 49);
    const bodies: number[] = [];
    for (let j = from; j <= i; j++) {
      const b = bodySize(j);
      if (b > 0) bodies.push(b);
    }
    const m = median(bodies);
    return m > 0 ? m : Math.max(1e-8, candles[i].close * 0.001);
  };

  // ---- disparity index (SMA of closes) ---------------------------------------
  const disp: Array<number | null> = new Array(n).fill(null);
  let smaSum = 0;
  for (let i = 0; i < n; i++) {
    smaSum += candles[i].close;
    if (i >= cfg.dispLen) smaSum -= candles[i - cfg.dispLen].close;
    if (i >= cfg.dispLen - 1) {
      const sma = smaSum / cfg.dispLen;
      disp[i] = sma !== 0 ? (candles[i].close - sma) / sma : 0;
    }
  }

  // ---- the two trails ---------------------------------------------------------
  const kAt = (i: number, w: number): number =>
    clamp(cfg.kBase + cfg.lambda * flipsIn(i, w) - cfg.mu * Math.min(runLen[i], cfg.runCap), cfg.kMin, cfg.kMax);

  // Walking (ratcheting) state.
  let wReg: 1 | -1 = dir.find((d) => d !== 0) === -1 ? -1 : 1;
  let wLine = wReg === 1
    ? candles[0].low - kAt(0, cfg.wWalk) * brickAt(0)
    : candles[0].high + kAt(0, cfg.wWalk) * brickAt(0);
  // Running (non-ratcheting) state.
  let rReg: 1 | -1 = wReg;
  let rLine = wLine;

  let brickUnit = brickAt(0);

  for (let i = 0; i < n; i++) {
    const B = brickAt(i);
    brickUnit = B;
    const c = candles[i];
    const kW = kAt(i, cfg.wWalk) ;
    const kR = Math.max(cfg.kMin * cfg.kRunRatio, kAt(i, cfg.wRun) * cfg.kRunRatio);

    if (i > 0) {
      // Walking: flip first (against yesterday's line), then ratchet.
      if (wReg === 1 && c.close < wLine) {
        wReg = -1;
        wLine = c.high + kW * B;
      } else if (wReg === -1 && c.close > wLine) {
        wReg = 1;
        wLine = c.low - kW * B;
      } else {
        wLine = wReg === 1 ? Math.max(wLine, c.low - kW * B) : Math.min(wLine, c.high + kW * B);
      }
      // Running: flip, otherwise follow price freely (no ratchet).
      if (rReg === 1 && c.close < rLine) {
        rReg = -1;
        rLine = c.high + kR * B;
      } else if (rReg === -1 && c.close > rLine) {
        rReg = 1;
        rLine = c.low - kR * B;
      } else {
        rLine = rReg === 1 ? c.low - kR * B : c.high + kR * B;
      }
    }

    // Article-explicit ordering: Running is the UPPER edge of a bullish cloud
    // and the LOWER edge of a bearish one — the edges must never invert.
    if (wReg === 1) rLine = Math.max(rLine, wLine);
    else rLine = Math.min(rLine, wLine);

    walk[i] = wLine;
    run[i] = rLine;
    regime[i] = wReg;
    cloudWidth[i] = Math.abs(rLine - wLine) / B;
  }

  // ---- events ------------------------------------------------------------------
  // Donchian bands over highs/lows for continuation arrows (transition-only).
  const upper: number[] = new Array(n).fill(NaN);
  const lower: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - cfg.donchianLen + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = from; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  for (let i = 2; i < n; i++) {
    if (regime[i] === 1 && upper[i] > upper[i - 1] && !(upper[i - 1] > upper[i - 2])) {
      events.push({ type: 'arrow', direction: 'bullish', barIndex: i });
    }
    if (regime[i] === -1 && lower[i] < lower[i - 1] && !(lower[i - 1] < lower[i - 2])) {
      events.push({ type: 'arrow', direction: 'bearish', barIndex: i });
    }
  }

  // P: trend leg (>= 2 same-direction bars) -> pullback (1..maxPullbackLen
  // counter bars) -> first resumption bar, all inside the same regime. The
  // trend-leg requirement keeps alternating chop from printing a P per bar.
  for (let i = 2; i < n; i++) {
    const d = regime[i];
    if (d === 0 || dir[i] !== d || dir[i - 1] !== -d) continue;
    const pull = runLen[i - 1];
    if (pull > cfg.maxPullbackLen) continue;
    const legEnd = i - 1 - pull;
    if (legEnd < 1 || dir[legEnd] !== d || runLen[legEnd] < 2) continue;
    if (regime[legEnd] !== d) continue;
    events.push({ type: 'pullback', direction: d === 1 ? 'bullish' : 'bearish', barIndex: i - 1 });
  }

  // Star: direction flip while disparity was stretched on the prior bar.
  for (let i = 1; i < n; i++) {
    const dPrev = disp[i - 1];
    if (dPrev == null) continue;
    if (dir[i] === -1 && dir[i - 1] === 1 && dPrev >= cfg.dispThreshold) {
      events.push({ type: 'star', direction: 'bearish', barIndex: i });
    } else if (dir[i] === 1 && dir[i - 1] === -1 && dPrev <= -cfg.dispThreshold) {
      events.push({ type: 'star', direction: 'bullish', barIndex: i });
    }
  }

  events.sort((a, b) => a.barIndex - b.barIndex);
  return { walk, run, regime, cloudWidth, events, brickUnit };
}
