// SMC-Screener — gate-based decision engine (spec 2026-07-11-smc-screener-design.md).
//
// Evaluates the institutional workflow over multi-timeframe candles:
//   HARD GATES  Trend → Structure → Liquidity → Order Block (any fail ⇒ NO_TRADE)
//   CONTEXT     Momentum, Volatility, FVG, Zone, Volume (soft — score/quality only)
//   TRADE PLAN  entry / stop / target / RR / quality (hard gates must pass)
//   DECISION    status (independent of score) + narrative + missing conditions
//
// Headless and pure: consumes the SMC engine snapshot + local indicator math,
// returns data. The UI renders; the engine never says a bare BUY/SELL.

import type { Candle, Timeframe } from '@/lib/types';
import { computeSmc } from './engine';
import type { SmcObject, SmcSnapshot } from './types';

// ---------------------------------------------------------------- contracts

export type ScreenerStatus = 'NO_TRADE' | 'WATCH' | 'BUILDING' | 'READY' | 'CONFIRMED';
export type ScreenerItemStatus = 'pass' | 'fail' | 'warn' | 'na';

export interface ScreenerItem {
  id: string;
  label: string;
  status: ScreenerItemStatus;
  detail?: string;
}

export interface ScreenerGroup {
  id: string;
  name: string;
  weight: number;
  items: ScreenerItem[];
  /** 0–100: pass=1, warn=0.5 over evaluable (non-na) items. */
  score: number;
  pass: boolean;
}

export interface TradePlan {
  entry: number;
  stop: number;
  target: number;
  rr: number;
  targetLabel: string;
  quality: 1 | 2 | 3 | 4 | 5;
}

/** One step of the Institutional Workflow (the setup's lifecycle journey). */
export interface WorkflowStage {
  id: 'trend' | 'liquidity_building' | 'sweep' | 'choch' | 'bos' | 'orderBlock' | 'retest' | 'entry';
  label: string;
  /** done = ✓, active = ⏳ (first incomplete), pending = ○ */
  state: 'done' | 'active' | 'pending';
  /** Bars since completion (null for state-like stages or when pending). */
  barsAgo: number | null;
}

export interface ScreenerReport {
  direction: 'long' | 'short' | null;
  status: ScreenerStatus;
  /** Weighted confluence 0–100 — always computed, independent of status. */
  score: number;
  /** The institutional story, headline-first. */
  narrative: string[];
  hardGates: ScreenerGroup[];
  contextChecks: ScreenerGroup[];
  /** First failed hard gate, phrased as advice. Null when all gates pass. */
  blockingReason: string | null;
  /** Actions the market must complete for the setup to advance. */
  missing: string[];
  /** The 8-stage Institutional Workflow — one journey, not another percentage. */
  workflow: WorkflowStage[];
  /** The actionable headline: what the setup is waiting for right now. */
  currentPhase: string;
  /** Predictive: the event to watch for on the chart next. */
  nextExpectedEvent: string;
  /** What would cancel the setup idea (risk-management coaching). */
  invalidation: string[];
  tradePlan: TradePlan | null;
}

export interface ScreenerWeights {
  trend: number;
  structure: number;
  liquidity: number;
  orderBlock: number;
  momentum: number;
  volatility: number;
  fvg: number;
  zone: number;
  volume: number;
}

export interface ScreenerConfig {
  weights: ScreenerWeights;
  minObStrength: number;
  maxObAgeBars: number;
  minRR: number;
  maxStopPct: number;
  rsiBull: number;
  adxMin: number;
  volSpikeMult: number;
  approachAtrMult: number;
  lookbackBars: number;
}

export const DEFAULT_SCREENER_CONFIG: ScreenerConfig = {
  weights: {
    trend: 20, structure: 20, liquidity: 15, orderBlock: 10,
    momentum: 10, volatility: 10, fvg: 5, zone: 5, volume: 5,
  },
  minObStrength: 80,
  maxObAgeBars: 50,
  minRR: 3,
  maxStopPct: 2,
  rsiBull: 55,
  adxMin: 25,
  volSpikeMult: 1.5,
  approachAtrMult: 2,
  lookbackBars: 100,
};

// ---------------------------------------------------------------- indicator math
// Local Wilder-style helpers (pure, unit-tested) — deliberately independent of
// the indicator-framework plot shapes.

export function sma(values: number[], len: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= len) sum -= values[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function ema(values: number[], len: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < len) return out;
  let seed = 0;
  for (let i = 0; i < len; i++) seed += values[i];
  let prev = seed / len;
  out[len - 1] = prev;
  const k = 2 / (len + 1);
  for (let i = len; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], len = 14): number {
  if (closes.length < len + 1) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= len;
  loss /= len;
  for (let i = len + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (len - 1) + Math.max(0, d)) / len;
    loss = (loss * (len - 1) + Math.max(0, -d)) / len;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macdLastRelation(closes: number[]): { line: number; signal: number } {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line: number[] = closes.map((_, i) =>
    Number.isFinite(fast[i]) && Number.isFinite(slow[i]) ? fast[i] - slow[i] : NaN,
  );
  const valid = line.filter(Number.isFinite);
  const sig = ema(valid, 9);
  return { line: valid[valid.length - 1] ?? NaN, signal: sig[sig.length - 1] ?? NaN };
}

export function atrSeries(candles: Candle[], len = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let atr = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close));
    atr = i === 0 ? tr : (atr * (len - 1) + tr) / len;
    if (i >= len - 1) out[i] = atr;
  }
  return out;
}

export function adx(candles: Candle[], len = 14): number {
  if (candles.length < 2 * len + 1) return NaN;
  let trS = 0;
  let plusS = 0;
  let minusS = 0;
  let dxSum = 0;
  let dxCount = 0;
  let adxVal = NaN;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.high - p.high;
    const dn = p.low - c.low;
    const plusDM = up > dn && up > 0 ? up : 0;
    const minusDM = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    if (i <= len) {
      trS += tr;
      plusS += plusDM;
      minusS += minusDM;
      if (i < len) continue;
    } else {
      trS = trS - trS / len + tr;
      plusS = plusS - plusS / len + plusDM;
      minusS = minusS - minusS / len + minusDM;
    }
    const plusDI = trS === 0 ? 0 : (100 * plusS) / trS;
    const minusDI = trS === 0 ? 0 : (100 * minusS) / trS;
    const dx = plusDI + minusDI === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);
    if (!Number.isFinite(adxVal)) {
      dxSum += dx;
      dxCount++;
      if (dxCount === len) adxVal = dxSum / len;
    } else {
      adxVal = (adxVal * (len - 1) + dx) / len;
    }
  }
  return adxVal;
}

function bbWidthSeries(closes: number[], len = 20, mult = 2): number[] {
  const mid = sma(closes, len);
  const out = new Array<number>(closes.length).fill(NaN);
  for (let i = len - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - len + 1; j <= i; j++) variance += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / len);
    out[i] = mid[i] === 0 ? NaN : (2 * mult * sd) / mid[i];
  }
  return out;
}

// ---------------------------------------------------------------- helpers

const item = (id: string, label: string, status: ScreenerItemStatus, detail?: string): ScreenerItem =>
  ({ id, label, status, detail });

function group(id: string, name: string, weight: number, items: ScreenerItem[], pass: boolean): ScreenerGroup {
  const evaluable = items.filter((i) => i.status !== 'na');
  const pts = evaluable.reduce((s, i) => s + (i.status === 'pass' ? 1 : i.status === 'warn' ? 0.5 : 0), 0);
  const score = evaluable.length === 0 ? 0 : Math.round((pts / evaluable.length) * 100);
  return { id, name, weight, items, score, pass };
}

const LIVE = new Set(['active', 'tested', 'partial']);

// ---------------------------------------------------------------- evaluation

export function evaluateSmcScreener(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
  config?: Partial<ScreenerConfig>,
): ScreenerReport {
  const cfg: ScreenerConfig = {
    ...DEFAULT_SCREENER_CONFIG,
    ...config,
    weights: { ...DEFAULT_SCREENER_CONFIG.weights, ...config?.weights },
  };
  const candles = candlesByTf[evalTf] ?? [];
  const n = candles.length;
  const last = candles[n - 1];

  // ---------- Gate 1: Trend (also determines direction) ----------
  const trendChecks: Array<{ tf: Timeframe; label: string; vote: number; weight: number; ok: boolean | null }> = [];
  const trendDef: Array<[Timeframe, 'ema200' | 'ema50v200' | 'ema20v50', string, number]> = [
    ['1d', 'ema200', 'Daily close vs EMA200', 2],
    ['4h', 'ema200', '4H close vs EMA200', 1],
    ['1h', 'ema50v200', '1H EMA50 vs EMA200', 1],
    ['15m', 'ema20v50', '15m EMA20 vs EMA50', 1],
  ];
  for (const [tf, kind, label, weight] of trendDef) {
    const series = candlesByTf[tf];
    const closes = series?.map((c) => c.close) ?? [];
    let vote: number | null = null;
    if (kind === 'ema200' && closes.length >= 200) {
      const e = ema(closes, 200);
      vote = closes[closes.length - 1] > e[e.length - 1] ? 1 : -1;
    } else if (kind === 'ema50v200' && closes.length >= 200) {
      const e50 = ema(closes, 50);
      const e200 = ema(closes, 200);
      vote = e50[e50.length - 1] > e200[e200.length - 1] ? 1 : -1;
    } else if (kind === 'ema20v50' && closes.length >= 50) {
      const e20 = ema(closes, 20);
      const e50 = ema(closes, 50);
      vote = e20[e20.length - 1] > e50[e50.length - 1] ? 1 : -1;
    }
    trendChecks.push({ tf, label, vote: vote ?? 0, weight, ok: vote === null ? null : vote > 0 });
  }
  const trendSum = trendChecks.reduce((s, c) => s + c.vote * c.weight, 0);
  const direction: 'long' | 'short' | null = trendSum > 0 ? 'long' : trendSum < 0 ? 'short' : null;
  const dirWord = direction === 'long' ? 'Bullish' : 'Bearish';
  const smcDir = direction === 'long' ? 'bullish' : 'bearish';

  const daily = trendChecks[0];
  const dailyAgainst = daily.ok !== null && direction !== null && (daily.ok ? 'long' : 'short') !== direction;
  const trendItems = trendChecks.map((c) =>
    item(
      `trend_${c.tf}`,
      c.label,
      c.ok === null ? 'na' : direction === null ? 'warn' : (c.ok ? 'long' : 'short') === direction ? 'pass' : 'fail',
      c.ok === null ? 'insufficient history' : c.ok ? 'bullish' : 'bearish',
    ),
  );
  const trendPass = direction !== null && !dailyAgainst;
  const trendGate = group('trend', 'Trend (MTF)', cfg.weights.trend, trendItems, trendPass);

  // ---------- SMC snapshot on the eval timeframe ----------
  const snap: SmcSnapshot = computeSmc(candles);
  const lastIdx = n - 1;
  const events = snap.events;
  const atr14 = atrSeries(candles, 14);
  const atrNow = atr14[lastIdx] || (last ? (last.high - last.low) || 1 : 1);

  // ---------- Gate 2: Market structure ----------
  const recentFrom = lastIdx - cfg.lookbackBars;
  const chochs = events.filter((e) => e.type === 'CHOCH' && e.direction === smcDir && e.barIndex >= recentFrom);
  const lastChoch = chochs[chochs.length - 1];
  const bosAfter = lastChoch
    ? events.find((e) => e.type === 'BOS' && e.direction === smcDir && e.barIndex >= lastChoch.barIndex)
    : undefined;
  const trendAgrees = direction !== null && snap.state.swingTrend === (direction === 'long' ? 1 : -1);
  const structureItems = [
    item('choch', `${dirWord} CHoCH`, lastChoch ? 'pass' : 'fail',
      lastChoch ? `bar ${lastChoch.barIndex}` : `none in last ${cfg.lookbackBars} bars`),
    item('bos', `${dirWord} BOS after CHoCH`, bosAfter ? 'pass' : 'fail',
      bosAfter ? `bar ${bosAfter.barIndex}` : 'awaiting confirmation'),
    item('swing_trend', 'Swing trend agrees', trendAgrees ? 'pass' : 'warn'),
  ];
  const structureGate = group('structure', 'Market Structure', cfg.weights.structure, structureItems,
    Boolean(lastChoch && bosAfter));

  // ---------- Gate 3: Liquidity ----------
  const sweep = events.filter(
    (e) => e.type === 'LIQUIDITY_SWEEP' && e.direction === smcDir && e.barIndex >= recentFrom,
  ).pop();
  const sweepSide = direction === 'long' ? 'Sell-side' : 'Buy-side';
  const targetSide = direction === 'long' ? 'bearish' : 'bullish';
  const targetPool = snap.objects.liquidityPools.find(
    (p) =>
      p.state === 'active' &&
      p.direction === targetSide &&
      last &&
      (direction === 'long' ? p.bottom > last.close : p.top < last.close),
  );
  const liquidityItems = [
    item('sweep', `${sweepSide} liquidity swept`, sweep ? 'pass' : 'fail',
      sweep ? `bar ${sweep.barIndex}` : 'no confirmed sweep yet'),
    item('target_pool', `${direction === 'long' ? 'Buy-side' : 'Sell-side'} liquidity ahead`,
      targetPool ? 'pass' : 'warn',
      targetPool ? `${targetPool.bottom.toFixed(1)}–${targetPool.top.toFixed(1)}` : 'no mapped pool — trailing extreme used as target'),
  ];
  const liquidityGate = group('liquidity', 'Liquidity', cfg.weights.liquidity, liquidityItems, Boolean(sweep));

  // ---------- Gate 4: Order block ----------
  const alignedLive = snap.objects.orderBlocks.filter(
    (o) => o.direction === smcDir && LIVE.has(o.state) && o.state !== 'partial',
  );
  const qualifying = alignedLive.filter(
    (o) => o.strength >= cfg.minObStrength && lastIdx - o.createdAtBar <= cfg.maxObAgeBars,
  );
  const ob: SmcObject | undefined = qualifying.sort((a, b) => b.strength - a.strength)[0];
  const bestLive = ob ?? alignedLive.sort((a, b) => b.strength - a.strength)[0];
  const obItems = [
    item('ob_active', `Active ${dirWord} Order Block`, alignedLive.length > 0 ? 'pass' : 'fail',
      alignedLive.length > 0 ? `${alignedLive.length} live` : 'none live'),
    item('ob_fresh', 'Fresh (untested)', bestLive ? (bestLive.state === 'active' ? 'pass' : 'warn') : 'na',
      bestLive?.state),
    item('ob_strength', `Strength ≥ ${cfg.minObStrength}`, bestLive ? (bestLive.strength >= cfg.minObStrength ? 'pass' : 'fail') : 'na',
      bestLive ? String(bestLive.strength) : undefined),
    item('ob_age', `Age ≤ ${cfg.maxObAgeBars} bars`, bestLive ? (lastIdx - bestLive.createdAtBar <= cfg.maxObAgeBars ? 'pass' : 'fail') : 'na',
      bestLive ? `${lastIdx - bestLive.createdAtBar} bars` : undefined),
  ];
  const obGate = group('orderBlock', 'Order Block', cfg.weights.orderBlock, obItems, Boolean(ob));

  const hardGates = [trendGate, structureGate, liquidityGate, obGate];

  // ---------- Context layer ----------
  const closes = candles.map((c) => c.close);
  const rsiNow = rsi(closes, 14);
  const macdNow = macdLastRelation(closes);
  const adxNow = adx(candles, 14);
  const rsiOk = direction === 'long' ? rsiNow > cfg.rsiBull : rsiNow < 100 - cfg.rsiBull;
  const macdOk = direction === 'long' ? macdNow.line > macdNow.signal : macdNow.line < macdNow.signal;
  const momentum = group('momentum', 'Momentum', cfg.weights.momentum, [
    item('rsi', direction === 'long' ? `RSI > ${cfg.rsiBull}` : `RSI < ${100 - cfg.rsiBull}`,
      Number.isFinite(rsiNow) ? (rsiOk ? 'pass' : 'fail') : 'na', Number.isFinite(rsiNow) ? rsiNow.toFixed(1) : undefined),
    item('macd', `MACD ${direction === 'long' ? 'bullish' : 'bearish'}`,
      Number.isFinite(macdNow.line) ? (macdOk ? 'pass' : 'fail') : 'na'),
    item('adx', `ADX > ${cfg.adxMin}`, Number.isFinite(adxNow) ? (adxNow > cfg.adxMin ? 'pass' : 'fail') : 'na',
      Number.isFinite(adxNow) ? adxNow.toFixed(1) : undefined),
  ], true);

  const atrSma = sma(atr14.map((v) => (Number.isFinite(v) ? v : 0)), 10);
  const atrRising = Number.isFinite(atr14[lastIdx]) && atr14[lastIdx] > atrSma[lastIdx];
  const bbw = bbWidthSeries(closes, 20, 2);
  const bbExpanding = Number.isFinite(bbw[lastIdx]) && Number.isFinite(bbw[lastIdx - 5]) && bbw[lastIdx] > bbw[lastIdx - 5];
  const vols = candles.map((c) => c.volume);
  const volSma = sma(vols, 20);
  const volSpike = last && Number.isFinite(volSma[lastIdx]) && last.volume > cfg.volSpikeMult * volSma[lastIdx];
  const volatility = group('volatility', 'Volatility', cfg.weights.volatility, [
    item('atr_rising', 'ATR rising', n > 25 ? (atrRising ? 'pass' : 'fail') : 'na'),
    item('bb_expanding', 'Bollinger width expanding', n > 25 ? (bbExpanding ? 'pass' : 'fail') : 'na'),
    item('vol_spike', `Volume > ${cfg.volSpikeMult}× SMA20`, n > 20 ? (volSpike ? 'pass' : 'warn') : 'na'),
  ], true);

  const alignedGaps = snap.objects.fvgs.filter((g) => g.direction === smcDir && LIVE.has(g.state));
  const overlapGap = ob
    ? alignedGaps.find((g) => g.bottom <= ob.top && g.top >= ob.bottom)
    : undefined;
  const fvg = group('fvg', 'Fair Value Gap', cfg.weights.fvg, [
    item('fvg_unfilled', `Unfilled ${dirWord} FVG`, alignedGaps.length > 0 ? 'pass' : 'fail',
      alignedGaps.length > 0 ? `${alignedGaps.length} live` : undefined),
    item('fvg_overlap', 'FVG overlaps Order Block', ob ? (overlapGap ? 'pass' : 'fail') : 'na'),
  ], true);

  const wantZone = direction === 'long' ? 'discount' : 'premium';
  const zoneStatus: ScreenerItemStatus =
    snap.state.zone === wantZone ? 'pass' : snap.state.zone === 'equilibrium' ? 'warn' : 'fail';
  const zone = group('zone', 'Premium / Discount', cfg.weights.zone, [
    item('zone', `Price in ${wantZone} zone`, zoneStatus, snap.state.zone),
  ], true);

  const pressureOk = last ? (direction === 'long' ? last.close > last.open : last.close < last.open) : false;
  const volume = group('volume', 'Volume', cfg.weights.volume, [
    item('vol_above', 'Volume > SMA20', last && Number.isFinite(volSma[lastIdx]) ? (last.volume > volSma[lastIdx] ? 'pass' : 'fail') : 'na',
      last && Number.isFinite(volSma[lastIdx]) ? `${last.volume.toFixed(1)} vs ${volSma[lastIdx].toFixed(1)}` : undefined),
    item('pressure', `${direction === 'long' ? 'Buying' : 'Selling'} pressure`, last ? (pressureOk ? 'pass' : 'warn') : 'na'),
    item('delta', 'Positive delta', 'na', 'order-flow delta — future'),
  ], true);

  const contextChecks = [momentum, volatility, fvg, zone, volume];

  // ---------- Score (independent of status) ----------
  const allGroups = [...hardGates, ...contextChecks];
  const sumW = allGroups.reduce((s, g) => s + g.weight, 0);
  const score = Math.round(allGroups.reduce((s, g) => s + g.score * g.weight, 0) / (sumW || 1));

  // ---------- Trade plan ----------
  const gatesPass = direction !== null && hardGates.every((g) => g.pass);
  let tradePlan: TradePlan | null = null;
  if (gatesPass && ob && last) {
    const long = direction === 'long';
    const entry = long ? ob.top : ob.bottom;
    const stop = long ? ob.bottom - 0.1 * atrNow : ob.top + 0.1 * atrNow;
    const risk = Math.abs(entry - stop);
    let target: number;
    let targetLabel: string;
    if (targetPool) {
      target = long ? targetPool.bottom : targetPool.top;
      targetLabel = long ? 'Buy-side liquidity (EQH)' : 'Sell-side liquidity (EQL)';
    } else {
      const extreme = long ? snap.state.trailing.top : snap.state.trailing.bottom;
      const beyond = long ? extreme > entry : extreme < entry;
      target = beyond ? extreme : long ? entry + 3 * risk : entry - 3 * risk;
      targetLabel = beyond ? (long ? 'Prior swing high' : 'Prior swing low') : 'Projected 3R';
    }
    const rr = risk > 0 ? Math.abs(target - entry) / risk : 0;
    const quality = Math.min(5, Math.max(1, Math.round(((score / 100) * 0.6 + (Math.min(rr, 5) / 5) * 0.4) * 5))) as TradePlan['quality'];
    tradePlan = { entry, stop, target, rr: Math.round(rr * 10) / 10, targetLabel, quality };
  }

  // ---------- Status (independent of score) ----------
  let status: ScreenerStatus = 'NO_TRADE';
  let blockingReason: string | null = null;
  if (!gatesPass) {
    const failed = direction === null ? trendGate : hardGates.find((g) => !g.pass);
    blockingReason =
      direction === null
        ? 'No clear higher-timeframe trend — stand aside.'
        : failed?.id === 'trend'
          ? 'Higher-timeframe (Daily) trend is against this setup.'
          : failed?.id === 'structure'
            ? `Wait for a ${dirWord.toLowerCase()} CHoCH and confirming BOS.`
            : failed?.id === 'liquidity'
              ? `Wait for a ${sweepSide.toLowerCase()} liquidity sweep before entering.`
              : 'No qualifying Order Block — wait for a fresh, strong block.';
  } else if (ob && last) {
    const inOb = last.close <= ob.top && last.close >= ob.bottom;
    const entry = direction === 'long' ? ob.top : ob.bottom;
    const nearOb = Math.abs(last.close - entry) <= cfg.approachAtrMult * atrNow;
    const eventNow = events.some(
      (e) => e.barIndex === lastIdx && e.direction === smcDir &&
        (e.type === 'BOS' || e.type === 'CHOCH' || e.type === 'LIQUIDITY_SWEEP'),
    );
    status = inOb ? (eventNow ? 'CONFIRMED' : 'READY') : nearOb ? 'BUILDING' : 'WATCH';
  }

  // ---------- Missing conditions + progress ----------
  const missing: string[] = [];
  for (const g of allGroups) {
    for (const it of g.items) {
      if (it.status === 'fail') missing.push(it.label);
    }
  }
  if (gatesPass && ob && (status === 'WATCH' || status === 'BUILDING')) {
    missing.unshift(`Price must revisit the ${dirWord} Order Block near ${(direction === 'long' ? ob.top : ob.bottom).toFixed(1)}`);
  }

  // ---------- Institutional Workflow (the setup's journey) ----------
  // Stages are marked independently (markets don't follow a strict script);
  // the ACTIVE stage is the first incomplete one in institutional order.
  const eqFormed = events.filter(
    (e) => (direction === 'long' ? e.type === 'EQL_FORMED' : e.type === 'EQH_FORMED') && e.barIndex >= recentFrom,
  ).pop();
  const retested = Boolean(ob && (ob.touches > 0 || (last && last.close <= ob.top && last.close >= ob.bottom)));
  const stageDefs: Array<{ id: WorkflowStage['id']; label: string; done: boolean; barsAgo: number | null }> = [
    { id: 'trend', label: 'Trend Established', done: trendPass, barsAgo: null },
    {
      id: 'liquidity_building',
      label: 'Liquidity Building',
      done: Boolean(eqFormed),
      barsAgo: eqFormed ? lastIdx - eqFormed.barIndex : null,
    },
    {
      id: 'sweep',
      label: `${sweepSide} Liquidity Sweep`,
      done: Boolean(sweep),
      barsAgo: sweep ? lastIdx - sweep.barIndex : null,
    },
    {
      id: 'choch',
      label: `${dirWord} CHoCH`,
      done: Boolean(lastChoch),
      barsAgo: lastChoch ? lastIdx - lastChoch.barIndex : null,
    },
    {
      id: 'bos',
      label: `${dirWord} BOS`,
      done: Boolean(bosAfter),
      barsAgo: bosAfter ? lastIdx - bosAfter.barIndex : null,
    },
    {
      id: 'orderBlock',
      label: `${dirWord} Order Block`,
      done: Boolean(ob),
      barsAgo: ob ? lastIdx - ob.createdAtBar : null,
    },
    { id: 'retest', label: 'Retest', done: retested, barsAgo: ob && retested ? lastIdx - ob.updatedAtBar : null },
    { id: 'entry', label: 'Entry', done: status === 'CONFIRMED', barsAgo: null },
  ];
  const firstIncomplete = stageDefs.findIndex((s) => !s.done);
  const workflow: WorkflowStage[] = stageDefs.map((s, i) => ({
    id: s.id,
    label: s.label,
    state: s.done ? 'done' : i === firstIncomplete ? 'active' : 'pending',
    barsAgo: s.done ? s.barsAgo : null,
  }));

  // ---------- Current phase + next expected event ----------
  const PHASE: Record<WorkflowStage['id'], [phase: string, next: string]> = {
    trend: ['Establishing higher-timeframe trend', 'Higher-timeframe trend alignment'],
    liquidity_building: ['Waiting for liquidity to build (equal highs/lows)', `Equal ${direction === 'long' ? 'lows' : 'highs'} forming`],
    sweep: [`Waiting for a ${sweepSide.toLowerCase()} liquidity sweep`, `${sweepSide} Liquidity Sweep`],
    choch: [`Waiting for a ${dirWord.toLowerCase()} CHoCH`, `${dirWord} CHoCH`],
    bos: [`Waiting for ${dirWord.toLowerCase()} BOS confirmation`, `${dirWord} BOS`],
    orderBlock: [`Waiting for a qualifying ${dirWord.toLowerCase()} Order Block`, `${dirWord} Order Block formation`],
    retest: [`Waiting for ${dirWord} Order Block Retest`, `${dirWord} Order Block Retest`],
    entry: ['Waiting for entry confirmation at the Order Block', `Entry trigger (${dirWord.toLowerCase()} BOS, CHoCH or sweep at the block)`],
  };
  let currentPhase: string;
  let nextExpectedEvent: string;
  if (direction === null) {
    currentPhase = 'Establishing higher-timeframe trend';
    nextExpectedEvent = 'Higher-timeframe trend alignment';
  } else if (firstIncomplete === -1) {
    currentPhase = 'Setup complete — entry confirmed';
    nextExpectedEvent = 'Manage the position toward the liquidity target';
  } else {
    [currentPhase, nextExpectedEvent] = PHASE[stageDefs[firstIncomplete].id];
  }

  // ---------- Invalidation (what would make this idea wrong) ----------
  const invalidation: string[] = [];
  if (direction !== null) {
    if (ob) {
      const edge = direction === 'long' ? ob.bottom : ob.top;
      invalidation.push(`${dirWord} Order Block is mitigated (${direction === 'long' ? 'low breaks below' : 'high breaks above'} ${edge.toFixed(1)})`);
    }
    if (daily.ok !== null) {
      invalidation.push(`Daily close crosses ${direction === 'long' ? 'below' : 'above'} its EMA200 (trend flip)`);
    }
    const opposingLevel = snap.objects.structureLevels
      .filter((l) => l.state === 'active' && l.direction === smcDir)
      .pop();
    invalidation.push(
      opposingLevel
        ? `A ${direction === 'long' ? 'bearish' : 'bullish'} CHoCH forms (close ${direction === 'long' ? 'below' : 'above'} ${opposingLevel.top.toFixed(1)})`
        : `A ${direction === 'long' ? 'bearish' : 'bullish'} CHoCH forms against the setup`,
    );
  }

  // ---------- Narrative ----------
  const narrative: string[] = [];
  if (direction === null) {
    narrative.push('The higher-timeframe trend is mixed — no directional bias.');
  } else {
    if (daily.ok !== null) narrative.push(`Daily trend is ${daily.ok ? 'bullish' : 'bearish'}.`);
    if (lastChoch) narrative.push(`${evalTf} completed a ${dirWord.toLowerCase()} CHoCH.`);
    if (bosAfter) narrative.push(`${dirWord} BOS confirmed.`);
    if (sweep) narrative.push(`${sweepSide} liquidity has been swept.`);
    if (ob) narrative.push(`A ${ob.state === 'active' ? 'fresh ' : ''}${dirWord.toLowerCase()} Order Block is active (strength ${ob.strength}).`);
    if (overlapGap) narrative.push('The Order Block overlaps an unfilled Fair Value Gap.');
    if (zoneStatus === 'pass') narrative.push(`Price is in the ${wantZone} zone.`);
    if (last && Number.isFinite(volSma[lastIdx]) && last.volume > volSma[lastIdx]) narrative.push('Volume is above average.');
    narrative.push(`Institutional confluence is ${score >= 75 ? 'high' : score >= 55 ? 'moderate' : 'low'} (${score}/100).`);
  }
  narrative.push(`Trade status: ${status.replace('_', ' ')}.`);

  return {
    direction,
    status,
    score,
    narrative,
    hardGates,
    contextChecks,
    blockingReason,
    missing,
    workflow,
    currentPhase,
    nextExpectedEvent,
    invalidation,
    tradePlan,
  };
}
