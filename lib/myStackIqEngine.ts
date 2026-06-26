// MyStack IQ "Operating System" engine. It does NOT compute indicators itself —
// the live Market Qualification reuses the same indicator ports as the rest of
// the app; everything else is a deterministic, style-driven decision cascade.
// Pick a trading style -> timeframe, qualification weighting, indicator toolkit,
// strategy, setup, performance and recent trades all follow. Pure + unit-tested.

import type { Candle } from './types';
import * as pm from './pineMath';
import { computeRsi } from './indicators/rsi';
import { computeMacd } from './indicators/macd';
import { computeAdx } from './indicators/adx';
import { computeAtr } from './indicators/atr';

export type Difficulty = 'Easy' | 'Medium' | 'Advanced';
export type Bias = 'LONG ONLY' | 'SHORT ONLY' | 'BOTH';

export interface IndicatorRow { cat: string; name: string; setting: string; role: string; }
export interface RecentTrade { date: string; pair: string; result: 'Win' | 'Loss'; points: number; rr: string; }

export interface TradingStyle {
  id: string; name: string; emoji: string; tagline: string;
  hold: string; recommendedTf: string; altTfs: { label: string; tf: string }[]; difficulty: Difficulty; risk: string; expectedRR: string;
  about: { holdTime: string; bestMarket: string; avoid: string; bestSession: string; recommendedRisk: string; tradesPerDay: string };
  strategyName: string; strategyOverview: string; keyRules: string[]; bias: Bias; avoidNote: string;
  objective: { points: number; maxRisk: number; riskPct: number; accountRisk: string; profitFactor: number; expectedWinRate: number; positionSize: string; entryStyle: string; trend: string };
  performance: { winRate: number; profitFactor: number; avgWin: number; avgLoss: number; avgRR: number; avgPoints: number; trades: number };
  management: { trailMethod: string; moveSlToBe: string; partialProfit: string; maxHoldingTime: string };
  indicators: IndicatorRow[];
  recent: RecentTrade[];
}

export const WORKFLOW_STEPS = [
  { n: 1, label: 'Style', sub: 'Who are you today?' },
  { n: 2, label: 'Market', sub: 'Is the market right?' },
  { n: 3, label: 'Plan', sub: 'Build your trade plan' },
  { n: 4, label: 'Setup', sub: 'Wait for confirmation' },
  { n: 5, label: 'Execute', sub: 'Take the trade' },
  { n: 6, label: 'Manage', sub: 'Manage in real-time' },
  { n: 7, label: 'Review', sub: 'Review & improve' },
];

const SCALPING_INDICATORS: IndicatorRow[] = [
  { cat: 'Trend', name: 'EMA 9', setting: '(Fast)', role: 'Trend Direction' },
  { cat: 'Trend', name: 'EMA 21', setting: '(Medium)', role: 'Trend Confirmation' },
  { cat: 'Trend', name: 'EMA 200', setting: '(Primary)', role: 'Market Bias' },
  { cat: 'Momentum', name: 'RSI 14', setting: '(14)', role: 'Momentum' },
  { cat: 'Momentum', name: 'MACD (12,26,9)', setting: '(12,26,9)', role: 'Trend Strength' },
  { cat: 'Volume', name: 'Volume', setting: 'SMA 20', role: 'Volume Confirmation' },
  { cat: 'Volatility', name: 'ATR 14', setting: '(14)', role: 'Volatility / SL' },
  { cat: 'Entry', name: 'VWAP', setting: 'Auto', role: 'Intraday Bias' },
];

function recent(seed: number, pair = 'BTCUSDT'): RecentTrade[] {
  const base = [
    { date: 'May 31', result: 'Win' as const, points: 132, rr: '1 : 2.6' },
    { date: 'May 31', result: 'Win' as const, points: 156, rr: '1 : 3.1' },
    { date: 'May 30', result: 'Loss' as const, points: -48, rr: '1 : 1' },
    { date: 'May 30', result: 'Win' as const, points: 110, rr: '1 : 2.2' },
    { date: 'May 29', result: 'Win' as const, points: 140, rr: '1 : 2.8' },
    { date: 'May 29', result: 'Win' as const, points: 96, rr: '1 : 1.9' },
  ];
  return base.map((b, i) => ({ ...b, pair, points: b.points + ((seed + i) % 5) - 2 }));
}

export const TRADING_STYLES: TradingStyle[] = [
  {
    id: 'scalping', name: 'Scalping', emoji: '⚡', tagline: 'Capture small moves quickly.', hold: '30s - 15m', recommendedTf: '5m', altTfs: [{ label: 'Aggressive', tf: '3m' }, { label: 'Ultra', tf: '1m' }], difficulty: 'Advanced', risk: 'High', expectedRR: '1 : 2.5',
    about: { holdTime: '2 - 15 minutes', bestMarket: 'Trending with good volume', avoid: 'Low volume, choppy sideways market', bestSession: 'London - New York Overlap', recommendedRisk: '0.5% - 1% per trade', tradesPerDay: '2 - 5' },
    strategyName: 'Trend Continuation Scalping', strategyOverview: 'Trade in the direction of the trend (LONG only) when all conditions align. Look for small pullbacks to key levels for high probability entries.',
    keyRules: ['Price must be above 200 EMA', 'EMA 9 above EMA 21', 'ADX > 25 (Strong Trend)', 'RSI between 40 - 70', 'MACD above signal line', 'Volume above 20-period average', 'Enter on pullback to EMA 9/21 or VWAP bounce'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 150, maxRisk: 50, riskPct: 1, accountRisk: '1% ($100)', profitFactor: 2.38, expectedWinRate: 72, positionSize: '0.18 BTC', entryStyle: 'Pullback Entry', trend: 'Bullish' },
    performance: { winRate: 74, profitFactor: 2.38, avgWin: 118, avgLoss: 46, avgRR: 2.4, avgPoints: 118, trades: 152 },
    management: { trailMethod: 'ATR Trailing (1.5x)', moveSlToBe: 'After +50 Points', partialProfit: 'After TP1 (50%)', maxHoldingTime: '20 Minutes' },
    indicators: SCALPING_INDICATORS, recent: recent(0),
  },
  {
    id: 'intraday', name: 'Intraday', emoji: '📈', tagline: "Trade the day's moves.", hold: '15m - 6h', recommendedTf: '15m', altTfs: [{ label: 'Alternative', tf: '30m' }, { label: 'Confirm', tf: '1H' }], difficulty: 'Medium', risk: 'Medium', expectedRR: '1 : 2.2',
    about: { holdTime: '1 - 6 hours', bestMarket: 'Trending day with clear bias', avoid: 'Pre-news chop', bestSession: 'London / New York', recommendedRisk: '1% per trade', tradesPerDay: '1 - 3' },
    strategyName: 'Intraday Trend Following', strategyOverview: 'Follow the intraday bias from the higher timeframe and trade pullbacks during the active session.',
    keyRules: ['Price above 200 EMA on 1H', 'EMA 21 sloping up', 'ADX > 20', 'Enter on 15m pullback', 'Confirm with volume'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 250, maxRisk: 90, riskPct: 1, accountRisk: '1% ($100)', profitFactor: 2.24, expectedWinRate: 69, positionSize: '0.12 BTC', entryStyle: 'Pullback Entry', trend: 'Bullish' },
    performance: { winRate: 69, profitFactor: 2.24, avgWin: 240, avgLoss: 96, avgRR: 2.2, avgPoints: 240, trades: 118 },
    management: { trailMethod: 'EMA 21 Trail', moveSlToBe: 'After +1R', partialProfit: 'After TP1 (40%)', maxHoldingTime: '6 Hours' },
    indicators: SCALPING_INDICATORS, recent: recent(1),
  },
  {
    id: 'swing', name: 'Swing Trading', emoji: '🌊', tagline: 'Ride multi-day trends.', hold: '1 - 10 Days', recommendedTf: '4H', altTfs: [{ label: 'Confirm', tf: '1D' }, { label: 'Entry', tf: '1H' }], difficulty: 'Medium', risk: 'Medium', expectedRR: '1 : 2.8',
    about: { holdTime: '1 - 10 days', bestMarket: 'Strong multi-day trend', avoid: 'Tight ranges', bestSession: 'Any', recommendedRisk: '1 - 2% per trade', tradesPerDay: '2 - 5 / week' },
    strategyName: 'Swing Trend Continuation', strategyOverview: 'Hold multi-day moves in the direction of the 4H trend, entering on healthy pullbacks.',
    keyRules: ['Price above 200 EMA on 4H', 'Higher highs / higher lows', 'ADX > 20', 'Enter on 1H pullback', 'Wide ATR stop'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 900, maxRisk: 320, riskPct: 2, accountRisk: '2% ($200)', profitFactor: 2.52, expectedWinRate: 70, positionSize: '0.08 BTC', entryStyle: 'Pullback Entry', trend: 'Bullish' },
    performance: { winRate: 70, profitFactor: 2.52, avgWin: 880, avgLoss: 350, avgRR: 2.8, avgPoints: 880, trades: 64 },
    management: { trailMethod: 'ATR Trailing (2.5x)', moveSlToBe: 'After +1R', partialProfit: 'After TP1 (33%)', maxHoldingTime: '10 Days' },
    indicators: SCALPING_INDICATORS, recent: recent(2),
  },
  {
    id: 'trend', name: 'Trend Following', emoji: '🚀', tagline: 'Ride major trends.', hold: 'Days - Weeks', recommendedTf: '1D', altTfs: [{ label: 'Confirm', tf: '1W' }, { label: 'Entry', tf: '4H' }], difficulty: 'Easy', risk: 'Medium', expectedRR: '1 : 3.0',
    about: { holdTime: 'Days - weeks', bestMarket: 'Established macro trend', avoid: 'Range-bound regimes', bestSession: 'Any', recommendedRisk: '1 - 2% per trade', tradesPerDay: '1 - 4 / month' },
    strategyName: 'Macro Trend Following', strategyOverview: 'Stay with the dominant daily trend until it breaks, adding on confirmed continuation.',
    keyRules: ['Price above 200 EMA on 1D', 'Weekly trend aligned', 'ADX > 25', 'Pyramid on continuation', 'Trail with weekly structure'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 3000, maxRisk: 900, riskPct: 2, accountRisk: '2% ($200)', profitFactor: 2.78, expectedWinRate: 64, positionSize: '0.05 BTC', entryStyle: 'Breakout Entry', trend: 'Bullish' },
    performance: { winRate: 64, profitFactor: 2.78, avgWin: 2800, avgLoss: 900, avgRR: 3.0, avgPoints: 2800, trades: 38 },
    management: { trailMethod: 'Weekly Structure', moveSlToBe: 'After +1R', partialProfit: 'After TP1 (25%)', maxHoldingTime: 'Trend End' },
    indicators: SCALPING_INDICATORS, recent: recent(3),
  },
  {
    id: 'momentum', name: 'Momentum Trading', emoji: '🔥', tagline: 'Trade explosive moves.', hold: '15m - 4h', recommendedTf: '15m', altTfs: [{ label: 'Fast', tf: '5m' }, { label: 'Confirm', tf: '1H' }], difficulty: 'Advanced', risk: 'High', expectedRR: '1 : 2.1',
    about: { holdTime: '15 min - 4 hours', bestMarket: 'High volatility with volume spikes', avoid: 'Low volume drift', bestSession: 'News / open', recommendedRisk: '0.5 - 1% per trade', tradesPerDay: '2 - 6' },
    strategyName: 'Momentum Burst', strategyOverview: 'Trade strong momentum bursts confirmed by volume, exiting fast as momentum fades.',
    keyRules: ['Strong volume spike', 'MACD expanding', 'RSI > 60 (longs)', 'Enter on first pullback', 'Exit on momentum fade'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 200, maxRisk: 80, riskPct: 1, accountRisk: '1% ($100)', profitFactor: 2.05, expectedWinRate: 67, positionSize: '0.14 BTC', entryStyle: 'Breakout Entry', trend: 'Bullish' },
    performance: { winRate: 67, profitFactor: 2.05, avgWin: 190, avgLoss: 90, avgRR: 2.1, avgPoints: 190, trades: 96 },
    management: { trailMethod: 'ATR Trailing (1.0x)', moveSlToBe: 'After +50 Points', partialProfit: 'After TP1 (50%)', maxHoldingTime: '2 Hours' },
    indicators: SCALPING_INDICATORS, recent: recent(4),
  },
  {
    id: 'breakout', name: 'Breakout Trading', emoji: '🎯', tagline: 'Break key levels with volume.', hold: '1 - 6h', recommendedTf: '15m', altTfs: [{ label: 'Confirm', tf: '1H' }, { label: 'Entry', tf: '5m' }], difficulty: 'Medium', risk: 'High', expectedRR: '1 : 2.1',
    about: { holdTime: '1 - 6 hours', bestMarket: 'Consolidation before expansion', avoid: 'Mid-range entries', bestSession: 'Session open', recommendedRisk: '1% per trade', tradesPerDay: '1 - 4' },
    strategyName: 'Volume Breakout', strategyOverview: 'Enter on confirmed breakouts of key levels backed by a volume spike; avoid chasing.',
    keyRules: ['Clear level / range', 'Volume spike on break', 'Retest holds', 'ADX rising', 'Stop below structure'],
    bias: 'BOTH', avoidNote: 'Avoid mid-range entries.',
    objective: { points: 220, maxRisk: 90, riskPct: 1, accountRisk: '1% ($100)', profitFactor: 1.94, expectedWinRate: 65, positionSize: '0.13 BTC', entryStyle: 'Breakout Entry', trend: 'Neutral' },
    performance: { winRate: 65, profitFactor: 1.94, avgWin: 210, avgLoss: 108, avgRR: 2.1, avgPoints: 210, trades: 84 },
    management: { trailMethod: 'ATR Trailing (1.5x)', moveSlToBe: 'After retest', partialProfit: 'After TP1 (50%)', maxHoldingTime: '6 Hours' },
    indicators: SCALPING_INDICATORS, recent: recent(5),
  },
  {
    id: 'mean-reversion', name: 'Mean Reversion', emoji: '🔄', tagline: 'Fade extremes & revert.', hold: '1 - 12h', recommendedTf: '15m', altTfs: [{ label: 'Confirm', tf: '1H' }, { label: 'Entry', tf: '5m' }], difficulty: 'Medium', risk: 'Medium', expectedRR: '1 : 1.7',
    about: { holdTime: '1 - 12 hours', bestMarket: 'Range-bound / sideways', avoid: 'Strong trends', bestSession: 'Asian range', recommendedRisk: '1% per trade', tradesPerDay: '2 - 5' },
    strategyName: 'Range Mean Reversion', strategyOverview: 'Fade overextended moves back to the mean inside a defined range, with tight invalidation.',
    keyRules: ['Defined range', 'RSI > 70 or < 30', 'Price at band extreme', 'Reversal candle', 'Target the mean (VWAP)'],
    bias: 'BOTH', avoidNote: 'Avoid trending markets.',
    objective: { points: 120, maxRisk: 70, riskPct: 1, accountRisk: '1% ($100)', profitFactor: 1.65, expectedWinRate: 58, positionSize: '0.15 BTC', entryStyle: 'Reversal Entry', trend: 'Ranging' },
    performance: { winRate: 58, profitFactor: 1.65, avgWin: 110, avgLoss: 78, avgRR: 1.7, avgPoints: 110, trades: 76 },
    management: { trailMethod: 'Fixed Target', moveSlToBe: 'After +0.5R', partialProfit: 'At mean (50%)', maxHoldingTime: '12 Hours' },
    indicators: SCALPING_INDICATORS, recent: recent(6),
  },
  {
    id: 'position', name: 'Position Trading', emoji: '🏛', tagline: 'Long-term investing.', hold: 'Weeks - Months', recommendedTf: '1W', altTfs: [{ label: 'Confirm', tf: '1M' }, { label: 'Entry', tf: '1D' }], difficulty: 'Easy', risk: 'Low', expectedRR: '1 : 3.5',
    about: { holdTime: 'Weeks - months', bestMarket: 'Macro uptrend / accumulation', avoid: 'Leverage', bestSession: 'Any', recommendedRisk: '2 - 5% of portfolio', tradesPerDay: '1 - 3 / quarter' },
    strategyName: 'Macro Position', strategyOverview: 'Accumulate in macro uptrends and hold through volatility with structural stops.',
    keyRules: ['Weekly trend up', 'Above 200D EMA', 'Accumulate dips', 'Wide structural stop', 'Hold the trend'],
    bias: 'LONG ONLY', avoidNote: 'Avoid SHORT in this market.',
    objective: { points: 8000, maxRisk: 2500, riskPct: 5, accountRisk: '5% ($500)', profitFactor: 3.1, expectedWinRate: 62, positionSize: '0.03 BTC', entryStyle: 'Accumulation', trend: 'Bullish' },
    performance: { winRate: 62, profitFactor: 3.1, avgWin: 7600, avgLoss: 2300, avgRR: 3.5, avgPoints: 7600, trades: 22 },
    management: { trailMethod: 'Monthly Structure', moveSlToBe: 'After +1R', partialProfit: 'On targets (20%)', maxHoldingTime: 'Cycle End' },
    indicators: SCALPING_INDICATORS, recent: recent(7),
  },
];

export const STYLE_BY_ID = Object.fromEntries(TRADING_STYLES.map((s) => [s.id, s])) as Record<string, TradingStyle>;

// ---- Live Market Qualification (reuses the shared indicator ports) ----
export interface Qualification {
  price: number; ema200: number; trendBias: 'Long Only' | 'Short Only'; trendLabel: string; trendOk: boolean;
  adx: number; adxLabel: string; adxOk: boolean;
  volumePct: number; volumeLabel: string; volumeOk: boolean;
  macdLabel: string; macdOk: boolean;
  atrPct: number; atrLabel: string; atrOk: boolean;
  rsi: number; rsiLabel: string; rsiOk: boolean;
  sentiment: string; readiness: number;
}
function lastNum(arr: readonly unknown[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) { const d = arr[i]; if (typeof d === 'number' && Number.isFinite(d)) return d; if (d && typeof d === 'object' && 'value' in d) { const v = (d as { value: number }).value; if (Number.isFinite(v)) return v; } }
  return null;
}
const plot = (plots: { id: string; data: readonly unknown[] }[], id: string) => plots.find((p) => p.id === id)?.data ?? [];

export function qualifyMarket(candles: Candle[]): Qualification | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ema200 = lastNum(pm.emaPine(closes, Math.min(200, candles.length - 1))) ?? price;
  const trendOk = price >= ema200;
  const adx = lastNum(plot(computeAdx(candles).plots, 'adx')) ?? 0;
  const rsi = lastNum(plot(computeRsi(candles).plots, 'rsi')) ?? 50;
  const macd = lastNum(plot(computeMacd(candles).plots, 'macd'));
  const signal = lastNum(plot(computeMacd(candles).plots, 'signal'));
  const macdOk = macd != null && signal != null ? macd > signal : false;
  const atr = lastNum(plot(computeAtr(candles).plots, 'atr')) ?? 0;
  const atrPct = price ? (atr / price) * 100 : 0;
  const vols = candles.map((c) => c.volume);
  const volSma = lastNum(pm.sma(vols, 20)) ?? 0;
  const lastVol = vols[vols.length - 1] ?? 0;
  const volumePct = volSma ? ((lastVol - volSma) / volSma) * 100 : 0;
  const volumeOk = lastVol >= volSma;
  const adxOk = adx >= 25;
  const rsiOk = rsi >= 40 && rsi <= 70;
  const atrOk = atrPct < 1;
  const checks = [trendOk, adxOk, volumeOk, macdOk, rsiOk];
  const readiness = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return {
    price: +price.toFixed(1), ema200: +ema200.toFixed(1),
    trendBias: trendOk ? 'Long Only' : 'Short Only', trendLabel: trendOk ? 'BULLISH MARKET' : 'BEARISH MARKET', trendOk,
    adx: +adx.toFixed(1), adxLabel: adx >= 25 ? 'Strong' : adx >= 20 ? 'Moderate' : 'Weak', adxOk,
    volumePct: +volumePct.toFixed(0), volumeLabel: volumeOk ? 'Above Average' : 'Below Average', volumeOk,
    macdLabel: macdOk ? 'Bullish' : 'Bearish', macdOk,
    atrPct: +atrPct.toFixed(2), atrLabel: atrPct < 0.5 ? 'Low' : atrPct < 1 ? 'Moderate' : 'High', atrOk,
    rsi: +rsi.toFixed(1), rsiLabel: rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : rsi >= 40 ? 'Healthy' : 'Weak', rsiOk,
    sentiment: trendOk && macdOk ? 'Bullish' : !trendOk && !macdOk ? 'Bearish' : 'Mixed', readiness,
  };
}

// Representative qualification (used before live candles arrive, matches the design).
export const SAMPLE_QUALIFICATION: Qualification = {
  price: 62764.8, ema200: 62180.5, trendBias: 'Long Only', trendLabel: 'BULLISH MARKET', trendOk: true,
  adx: 28.6, adxLabel: 'Strong', adxOk: true, volumePct: 22, volumeLabel: 'Above Average', volumeOk: true,
  macdLabel: 'Bullish', macdOk: true, atrPct: 0.42, atrLabel: 'Moderate', atrOk: true,
  rsi: 58.2, rsiLabel: 'Healthy', rsiOk: true, sentiment: 'Bullish', readiness: 94,
};

// ---- Setup generator (style + qualification + price) ----
export interface IqSetup { entryLo: number; entryHi: number; sl: number; tp1: number; tp2: number; rrOverall: string; slPoints: number; tp1Points: number; tp2Points: number; potentialProfit: number; potentialLoss: number; }
export function generateSetup(style: TradingStyle, price: number): IqSetup {
  const risk = style.objective.maxRisk;
  const reward = style.objective.points;
  const entryHi = +price.toFixed(0);
  const entryLo = +(price - risk * 0.8).toFixed(0);
  const sl = +(entryLo - risk).toFixed(0);
  const tp1 = +(entryHi + reward * 0.66).toFixed(0);
  const tp2 = +(entryHi + reward).toFixed(0);
  return {
    entryLo, entryHi, sl, tp1, tp2,
    rrOverall: `1 : ${(reward / risk).toFixed(1)}`,
    slPoints: -(risk + Math.round(risk * 0.8)), tp1Points: Math.round(reward * 0.66), tp2Points: reward,
    potentialProfit: reward, potentialLoss: -(risk),
  };
}

export function iqScore(style: TradingStyle, q: Qualification): { score: number; label: string; confidence: number; risk: string; discipline: number } {
  const score = Math.round(q.readiness * 0.6 + style.performance.winRate * 0.4);
  const label = score >= 90 ? 'Elite' : score >= 75 ? 'Strong' : score >= 60 ? 'Stable' : 'Weak';
  return { score, label, confidence: Math.min(99, q.readiness + 0), risk: style.risk === 'Low' ? 'Low' : style.risk === 'High' ? 'High' : 'Low', discipline: 91 };
}
