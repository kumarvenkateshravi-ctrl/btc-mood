// Stack Score factor engine (the spec's decision-aggregation layer). It does NOT
// recompute indicators: it consumes the alignment matrix, consensus, market
// structure and timeframe details from the Multi-Timeframe engine and reduces
// them to the 7 weighted factors + a final score, recommendation, confidence,
// probability model, insights and improvement suggestions. Pure + unit-tested.

import type { Timeframe } from './types';
import type { AlignmentMatrix, Verdict } from './alignment';
import type { Consensus, MarketStructure, TimeframeDetails } from './multiTimeframe';

export type FactorKey = 'trend' | 'momentum' | 'volume' | 'structure' | 'volatility' | 'consensus' | 'sentiment';
export type Recommendation = 'STRONG BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG SELL';
export type Impact = 'High' | 'Medium' | 'Low';

export const FACTOR_WEIGHT: Record<FactorKey, number> = {
  trend: 0.25, momentum: 0.15, volume: 0.15, structure: 0.15, volatility: 0.1, consensus: 0.15, sentiment: 0.05,
};

export interface Factor {
  key: FactorKey;
  label: string;
  sub: string;
  score: number; // 0–100
  weight: number;
  rating: string; // Bullish / Bearish / Weak / Strong / Normal …
  verdict: Verdict;
  explanation: string;
  detail: string;
  impact: Impact;
}

export interface Insight { tone: 'bear' | 'bull' | 'warn' | 'info' | 'ok'; text: string; }
export interface Improvement { key: FactorKey; label: string; advice: string; potential: number; }

export interface StackScoreResult {
  score: number;
  recommendation: Recommendation;
  direction: 'buy' | 'sell' | 'neutral';
  stars: number;
  confidence: number;
  confidenceLabel: string;
  factors: Factor[];
  probability: number;
  riskReward: string;
  edgeQuality: string;
  tradeGrade: string;
  recStrength: string;
  invalidation: string;
  bestAction: string;
  insights: Insight[];
  improvements: Improvement[];
}

export interface FactorInputs {
  matrix: AlignmentMatrix;
  consensus: Consensus;
  structure: MarketStructure;
  details: TimeframeDetails; // the focus timeframe (e.g. 1h)
  atrPct: number; // ATR as % of price on the focus timeframe
  sentiment: number; // 0–100 (Fear & Greed proxy)
  price: number;
  tfs: Timeframe[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);
const verdictOf = (s: number): Verdict => (s > 55 ? 'bullish' : s < 45 ? 'bearish' : 'neutral');

/** Healthy volatility (steady ATR) scores high; chaotic / dead volatility scores low. */
export function volatilityScore(atrPct: number): number {
  if (!Number.isFinite(atrPct) || atrPct <= 0) return 50;
  if (atrPct < 0.3) return 55; // too quiet
  if (atrPct <= 1) return 80; // healthy
  if (atrPct <= 2) return clamp(80 - (atrPct - 1) * 40, 40, 80);
  return clamp(40 - (atrPct - 2) * 10, 25, 40); // chaotic
}

function recommend(score: number): { rec: Recommendation; direction: 'buy' | 'sell' | 'neutral'; stars: number } {
  if (score >= 80) return { rec: 'STRONG BUY', direction: 'buy', stars: 5 };
  if (score >= 60) return { rec: 'BUY', direction: 'buy', stars: 4 };
  if (score >= 40) return { rec: 'NEUTRAL', direction: 'neutral', stars: 3 };
  if (score >= 20) return { rec: 'SELL', direction: 'sell', stars: 2 };
  return { rec: 'STRONG SELL', direction: 'sell', stars: 1 };
}

function impactOf(score: number, weight: number): Impact {
  const x = Math.abs(score - 50) * weight;
  return x >= 4.5 ? 'High' : x >= 2.2 ? 'Medium' : 'Low';
}

export function computeStackScoreFactors(input: FactorInputs): StackScoreResult {
  const { matrix, consensus, structure, details, atrPct, sentiment, price, tfs } = input;
  const active = tfs.filter((tf) => matrix.sub[tf]);

  const trendS = avg(active.map((tf) => matrix.sub[tf]!.ema));
  const momentumS = avg(active.map((tf) => (matrix.sub[tf]!.rsi + matrix.sub[tf]!.macd) / 2));
  const volumeS = avg(active.map((tf) => (matrix.sub[tf]!.volume + matrix.sub[tf]!.obv) / 2));
  const structureS = structure.verdict === 'bullish' ? 80 : structure.verdict === 'bearish' ? 20 : 50;
  const volatilityS = volatilityScore(atrPct);
  const consensusS = consensus.pctBull;
  const sentimentS = clamp(sentiment, 0, 100);

  const rsi = details.momentum.rsi;
  const macdBelow = (details.momentum.macd ?? 0) < (details.momentum.signal ?? 0);
  const volPct = details.volume.vsPct ?? 0;

  const factorDefs: { key: FactorKey; label: string; sub: string; score: number; rating: (v: Verdict) => string; explanation: string; detail: string }[] = [
    {
      key: 'trend', label: 'Trend Alignment', sub: 'Price vs EMA 20/50/200 · Higher-timeframe trend', score: trendS,
      rating: (v) => (v === 'bullish' ? 'Bullish' : v === 'bearish' ? 'Bearish' : 'Mixed'),
      explanation: trendS < 45 ? 'Price below EMA20, EMA50 and EMA200' : trendS > 55 ? 'Price above EMA20, EMA50 and EMA200' : 'Price mixed versus the EMA stack',
      detail: `${tfDirText(matrix, active)} trend ${verdictWord(verdictOf(trendS))}`,
    },
    {
      key: 'momentum', label: 'Momentum Strength', sub: 'RSI, MACD · Momentum confirmation', score: momentumS,
      rating: (v) => (v === 'bullish' ? 'Strong' : v === 'bearish' ? 'Weak' : 'Neutral'),
      explanation: rsi != null ? `RSI (14) at ${rsi.toFixed(1)} (${rsi > 55 ? 'strong' : rsi < 45 ? 'weak' : 'flat'})` : 'RSI unavailable',
      detail: macdBelow ? 'MACD below signal line' : 'MACD above signal line',
    },
    {
      key: 'volume', label: 'Volume & Liquidity', sub: 'OBV, Volume vs SMA20 · Buying/selling pressure', score: volumeS,
      rating: (v) => (v === 'bullish' ? 'Strong' : v === 'bearish' ? 'Weak' : 'Normal'),
      explanation: `Volume ${volPct >= 0 ? '+' : ''}${volPct.toFixed(0)}% vs SMA20`,
      detail: matrix.sub[active[active.length - 1] ?? active[0]] && volumeS < 45 ? 'OBV trending down' : volumeS > 55 ? 'OBV trending up' : 'OBV flat',
    },
    {
      key: 'structure', label: 'Market Structure', sub: 'Higher Highs / Lower Lows · Breaks & retests', score: structureS,
      rating: (v) => (v === 'bullish' ? 'Bullish' : v === 'bearish' ? 'Bearish' : 'Ranging'),
      explanation: structure.sublabel,
      detail: structure.verdict === 'bearish' ? 'Recent support breakdown' : structure.verdict === 'bullish' ? 'Recent resistance breakout' : 'Range-bound price action',
    },
    {
      key: 'volatility', label: 'Volatility Conditions', sub: 'ATR, Bollinger Bands · Market stability', score: volatilityS,
      rating: () => (volatilityS >= 65 ? 'Healthy' : volatilityS >= 45 ? 'Normal' : 'Chaotic'),
      explanation: `ATR (14) ${atrPct.toFixed(2)}% of price`,
      detail: volatilityS >= 65 ? 'Stable, trend-friendly range' : volatilityS < 45 ? 'Erratic, hard to trade' : 'Moderate volatility',
    },
    {
      key: 'consensus', label: 'Multi-Timeframe Consensus', sub: 'Alignment across TFs · Signal agreement', score: consensusS,
      rating: (v) => (v === 'bullish' ? 'Bullish' : v === 'bearish' ? 'Bearish' : 'Mixed'),
      explanation: `${consensus.bull}/${consensus.total} timeframes bullish`,
      detail: consensus.bull === 0 ? 'All timeframes bearish' : consensus.bear === 0 ? 'All timeframes bullish' : 'Timeframes in conflict',
    },
    {
      key: 'sentiment', label: 'News & Sentiment', sub: 'Fear & Greed · Social sentiment', score: sentimentS,
      rating: (v) => (v === 'bullish' ? 'Positive' : v === 'bearish' ? 'Negative' : 'Neutral'),
      explanation: sentimentS < 45 ? 'Fearful sentiment dominant' : sentimentS > 55 ? 'Greedy sentiment dominant' : 'Balanced sentiment',
      detail: sentimentS < 30 ? 'Elevated fear in the market' : sentimentS > 70 ? 'Elevated greed in the market' : 'Sentiment near neutral',
    },
  ];

  const factors: Factor[] = factorDefs.map((f) => {
    const v = verdictOf(f.score);
    return {
      key: f.key, label: f.label, sub: f.sub, score: Math.round(f.score), weight: FACTOR_WEIGHT[f.key],
      rating: f.rating(v), verdict: v, explanation: f.explanation, detail: f.detail, impact: impactOf(f.score, FACTOR_WEIGHT[f.key]),
    };
  });

  const raw =
    trendS * FACTOR_WEIGHT.trend + momentumS * FACTOR_WEIGHT.momentum + volumeS * FACTOR_WEIGHT.volume +
    structureS * FACTOR_WEIGHT.structure + volatilityS * FACTOR_WEIGHT.volatility + consensusS * FACTOR_WEIGHT.consensus +
    sentimentS * FACTOR_WEIGHT.sentiment;
  const score = Math.round(clamp(raw, 0, 100));
  const { rec, direction, stars } = recommend(score);

  // Confidence: decisiveness + timeframe agreement.
  const agree = Math.abs(consensus.bull - consensus.bear) / Math.max(1, consensus.total);
  const confidence = Math.round(clamp(40 + Math.abs(score - 50) * 0.7 + agree * 15, 25, 95));
  const confidenceLabel = `${confidence >= 75 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'} (${confidence}%)`;

  const decisive = Math.abs(score - 50);
  const probability = Math.round(clamp(38 + decisive * 0.5, 30, 88));
  const rr = direction === 'neutral' ? '1.0 : 1' : `${(1 + decisive / 30).toFixed(1)} : 1`;
  const edgeQuality = decisive >= 25 ? 'High' : decisive >= 12 ? 'Medium' : 'Low';
  const tradeGrade = decisive >= 35 ? 'A' : decisive >= 25 ? 'B' : decisive >= 15 ? 'C' : decisive >= 8 ? 'D' : 'F';
  const recStrength = confidence >= 75 ? 'High' : confidence >= 50 ? 'Medium' : 'Low';
  const buffer = price * (clamp(atrPct, 0.2, 3) / 100) * 1.5;
  const invalidation = direction === 'sell'
    ? `Above ${Math.round(price + buffer).toLocaleString('en-US')} USDT`
    : direction === 'buy'
      ? `Below ${Math.round(price - buffer).toLocaleString('en-US')} USDT`
      : 'Wait for a decisive break';
  const bestAction = direction === 'buy' ? 'Consider Long on strength' : direction === 'sell' ? 'Consider Short or Stay Out' : 'Stand aside until alignment';

  const insights = buildInsights(factors, consensus);
  const improvements = buildImprovements(factors);

  return {
    score, recommendation: rec, direction, stars, confidence, confidenceLabel, factors,
    probability, riskReward: rr, edgeQuality, tradeGrade, recStrength, invalidation, bestAction,
    insights, improvements,
  };
}

const verdictWord = (v: Verdict) => (v === 'bullish' ? 'bullish' : v === 'bearish' ? 'bearish' : 'mixed');
function tfDirText(matrix: AlignmentMatrix, tfs: Timeframe[]): string {
  const higher = tfs.filter((t) => t === '1h' || t === '4h' || t === '1d');
  return higher.map((t) => t.toUpperCase()).join(', ') || 'All';
}

function buildInsights(factors: Factor[], consensus: Consensus): Insight[] {
  const out: Insight[] = [];
  const f = (k: FactorKey) => factors.find((x) => x.key === k)!;
  if (f('trend').verdict === 'bearish') out.push({ tone: 'bear', text: 'Strong bearish trend across timeframes' });
  else if (f('trend').verdict === 'bullish') out.push({ tone: 'bull', text: 'Bullish trend alignment building' });
  if (f('momentum').verdict !== 'bullish') out.push({ tone: 'bear', text: 'Weak momentum and selling pressure' });
  if (f('volume').score < 45) out.push({ tone: 'warn', text: 'Low volume confirms weak conviction' });
  if (consensus.bull === 0) out.push({ tone: 'bear', text: 'No bullish alignment on any timeframe' });
  else if (consensus.bull >= 4) out.push({ tone: 'bull', text: `${consensus.bull}/${consensus.total} timeframes bullish` });
  if (f('structure').verdict === 'bearish') out.push({ tone: 'warn', text: 'Wait for trend reversal or strong breakout' });
  out.push({ tone: 'ok', text: factors[0].verdict === 'bearish' ? 'Favor shorts on lower-timeframe setups' : 'Favor longs on pullbacks into support' });
  return out;
}

function buildImprovements(factors: Factor[]): Improvement[] {
  const advice: Record<FactorKey, string> = {
    trend: 'Wait for price to reclaim EMA20 & EMA50 on the 1H timeframe',
    momentum: 'Wait for RSI to cross above 50 and MACD to turn bullish',
    volume: 'Look for volume to expand above the 20-period SMA',
    structure: 'Wait for a higher low to form and a break of structure',
    consensus: 'Align at least 4/6 timeframes for bullish confirmation',
    volatility: 'Wait for volatility to settle into a trend-friendly range',
    sentiment: 'Watch for sentiment to turn from fear toward neutral',
  };
  const labels: Record<FactorKey, string> = {
    trend: 'Trend Alignment', momentum: 'Momentum', volume: 'Volume', structure: 'Structure',
    consensus: 'Timeframe Alignment', volatility: 'Volatility', sentiment: 'Sentiment',
  };
  return (['trend', 'momentum', 'volume', 'structure', 'consensus'] as FactorKey[]).map((k) => {
    const f = factors.find((x) => x.key === k)!;
    const potential = Math.round(clamp((70 - f.score) * f.weight, 5, 25));
    return { key: k, label: labels[k], advice: advice[k], potential };
  });
}
