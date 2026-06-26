// Strategies "Trading Strategy Operating System" engine. Holds the strategy
// library + DNA radar, market suitability, performance, comparison, live
// opportunities and the Strategy Health formula. The Indicator Stack is wired
// to LIVE BTC readings on the page; everything here is pure + unit-tested.

export type Difficulty = 'Easy' | 'Medium' | 'Advanced';
export type Category =
  | 'Scalping' | 'Day Trading' | 'Swing Trading' | 'Trend Following'
  | 'Breakouts' | 'Reversals' | 'Mean Reversion' | 'Momentum' | 'Position Trading';

export const CATEGORIES: Category[] = ['Scalping', 'Day Trading', 'Swing Trading', 'Trend Following', 'Breakouts', 'Reversals', 'Mean Reversion', 'Momentum', 'Position Trading'];

export interface DNA { trendStrength: number; momentum: number; riskReward: number; easeOfUse: number; winRate: number; consistency: number; }
export interface SuitRow { label: string; stars: number; bar: number; }
export interface Slice { label: string; pct: number; color: string; }
export interface TfBar { label: string; pct: number; }

export interface Strategy {
  id: string; name: string; tagline: string; categories: Category[];
  rating: number; reviews: number; winRate: number; profitFactor: number;
  bestMarket: string; difficulty: Difficulty; bestTf: string; health: number;
  sparkColor: string; spark: number[]; topPick?: boolean;
  dna: DNA;
  type: string; idealTfs: string; avgHold: string; winRateHist: string; avgRR: string;
  maxDD: string; volReq: string; volumeReq: string; experience: string; emotional: string; automation: string;
  quick: { totalTrades: number; winRate: number; profitFactor: number; avgRR: number; netProfit: number; maxDrawdown: number; expectancy: number; sharpe: number };
  bestMarkets: Slice[]; bestTimeframes: TfBar[];
  suitability: SuitRow[]; marketFit: number;
  health7: { trend: number; alignment: number; momentum: number; volume: number; stackScore: number; stack: number; risk: number };
  recent: { trades: number; winRate: number; profit: number; avgRR: number; series: number[] };
}

// ---- Strategy Health Engine (spec inputs) ----
export interface HealthInputs { trend: number; volume: number; alignment: number; momentum: number; volatility: number; regime: number; stackScore: number; }
export const HEALTH_WEIGHTS: HealthInputs = { trend: 0.2, alignment: 0.2, momentum: 0.15, volume: 0.1, volatility: 0.1, regime: 0.1, stackScore: 0.15 };
export function strategyHealth(i: HealthInputs): number {
  const v = i.trend * HEALTH_WEIGHTS.trend + i.alignment * HEALTH_WEIGHTS.alignment + i.momentum * HEALTH_WEIGHTS.momentum + i.volume * HEALTH_WEIGHTS.volume + i.volatility * HEALTH_WEIGHTS.volatility + i.regime * HEALTH_WEIGHTS.regime + i.stackScore * HEALTH_WEIGHTS.stackScore;
  return Math.max(0, Math.min(100, Math.round(v)));
}
export function healthLabel(h: number): string {
  if (h >= 90) return 'Excellent';
  if (h >= 75) return 'Strong';
  if (h >= 60) return 'Good';
  if (h >= 40) return 'Fair';
  return 'Weak';
}

const up = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)) + Math.sin(i * 1.3) * (b - a) * 0.06);
const choppy = (base: number, amp: number, n: number) => Array.from({ length: n }, (_, i) => base + Math.sin(i * 0.9) * amp + Math.sin(i * 2.1) * amp * 0.4);

export const STRATEGIES: Strategy[] = [
  {
    id: 'trend-continuation', name: 'Trend Continuation', tagline: 'Ride the trend with strength', categories: ['Trend Following', 'Swing Trading', 'Position Trading'],
    rating: 4.9, reviews: 128, winRate: 74, profitFactor: 2.41, bestMarket: 'Trending', difficulty: 'Easy', bestTf: '15m - 4H', health: 94, sparkColor: '#26A69A', spark: up(8, 22, 24), topPick: true,
    dna: { trendStrength: 9.2, momentum: 8.5, riskReward: 8.8, easeOfUse: 8.0, winRate: 8.7, consistency: 8.6 },
    type: 'Trend Following', idealTfs: '15m, 1H, 4H', avgHold: '6 - 24 Hours', winRateHist: '72%', avgRR: '1 : 2.8', maxDD: '8.4%', volReq: 'Medium - High', volumeReq: 'Above 20D Avg', experience: 'Intermediate', emotional: 'Low (Rule-Based)', automation: 'Yes',
    quick: { totalTrades: 642, winRate: 72.4, profitFactor: 2.41, avgRR: 2.18, netProfit: 28.72, maxDrawdown: 8.41, expectancy: 1.32, sharpe: 1.86 },
    bestMarkets: [{ label: 'Trending', pct: 62, color: '#26A69A' }, { label: 'Volatile', pct: 22, color: '#f0a020' }, { label: 'Ranging', pct: 10, color: '#f23645' }, { label: 'Reversal', pct: 6, color: '#a855f7' }],
    bestTimeframes: [{ label: '15m', pct: 72 }, { label: '1H', pct: 74 }, { label: '4H', pct: 69 }, { label: '1D', pct: 61 }],
    suitability: [{ label: 'Trending Market', stars: 4.5, bar: 90 }, { label: 'Ranging Market', stars: 2, bar: 40 }, { label: 'High Volatility', stars: 4.5, bar: 90 }, { label: 'Low Volatility', stars: 1.5, bar: 30 }, { label: 'High Volume', stars: 4.5, bar: 90 }, { label: 'Low Volume', stars: 1, bar: 20 }],
    marketFit: 94, health7: { trend: 96, alignment: 95, momentum: 92, volume: 88, stackScore: 93, stack: 93, risk: 90 },
    recent: { trades: 28, winRate: 75, profit: 9.34, avgRR: 2.28, series: up(0, 9.34, 30) },
  },
  {
    id: 'pullback', name: 'Pullback Strategy', tagline: 'Buy the dip in an uptrend', categories: ['Trend Following', 'Swing Trading', 'Day Trading'],
    rating: 4.7, reviews: 96, winRate: 69, profitFactor: 2.18, bestMarket: 'Trending', difficulty: 'Medium', bestTf: '15m - 1H', health: 89, sparkColor: '#26A69A', spark: up(10, 20, 24),
    dna: { trendStrength: 8.4, momentum: 7.8, riskReward: 8.5, easeOfUse: 7.2, winRate: 8.2, consistency: 8.0 },
    type: 'Trend Following', idealTfs: '15m, 1H', avgHold: '2 - 8 Hours', winRateHist: '69%', avgRR: '1 : 2.4', maxDD: '9.1%', volReq: 'Medium', volumeReq: 'Above Avg', experience: 'Intermediate', emotional: 'Medium', automation: 'Yes',
    quick: { totalTrades: 518, winRate: 69.0, profitFactor: 2.18, avgRR: 2.05, netProfit: 22.4, maxDrawdown: 9.1, expectancy: 1.12, sharpe: 1.64 },
    bestMarkets: [{ label: 'Trending', pct: 58, color: '#26A69A' }, { label: 'Volatile', pct: 24, color: '#f0a020' }, { label: 'Ranging', pct: 12, color: '#f23645' }, { label: 'Reversal', pct: 6, color: '#a855f7' }],
    bestTimeframes: [{ label: '15m', pct: 70 }, { label: '1H', pct: 71 }, { label: '4H', pct: 64 }, { label: '1D', pct: 55 }],
    suitability: [{ label: 'Trending Market', stars: 4.5, bar: 90 }, { label: 'Ranging Market', stars: 2.5, bar: 50 }, { label: 'High Volatility', stars: 4, bar: 80 }, { label: 'Low Volatility', stars: 2, bar: 40 }, { label: 'High Volume', stars: 4, bar: 80 }, { label: 'Low Volume', stars: 1.5, bar: 30 }],
    marketFit: 89, health7: { trend: 91, alignment: 90, momentum: 86, volume: 84, stackScore: 88, stack: 88, risk: 86 },
    recent: { trades: 24, winRate: 71, profit: 7.8, avgRR: 2.05, series: up(0, 7.8, 30) },
  },
  {
    id: 'breakout', name: 'Breakout Strategy', tagline: 'Capture explosive breakouts', categories: ['Breakouts', 'Momentum', 'Day Trading'],
    rating: 4.6, reviews: 84, winRate: 67, profitFactor: 2.05, bestMarket: 'Volatile', difficulty: 'Medium', bestTf: '15m - 1H', health: 86, sparkColor: '#6aa6ff', spark: up(6, 24, 24),
    dna: { trendStrength: 7.6, momentum: 9.0, riskReward: 8.2, easeOfUse: 6.8, winRate: 7.4, consistency: 7.0 },
    type: 'Momentum / Breakout', idealTfs: '15m, 1H', avgHold: '1 - 6 Hours', winRateHist: '67%', avgRR: '1 : 2.1', maxDD: '10.2%', volReq: 'High', volumeReq: 'Spike Required', experience: 'Intermediate', emotional: 'Medium', automation: 'Partial',
    quick: { totalTrades: 471, winRate: 67.0, profitFactor: 2.05, avgRR: 1.92, netProfit: 19.8, maxDrawdown: 10.2, expectancy: 0.98, sharpe: 1.48 },
    bestMarkets: [{ label: 'Volatile', pct: 54, color: '#f0a020' }, { label: 'Trending', pct: 30, color: '#26A69A' }, { label: 'Ranging', pct: 10, color: '#f23645' }, { label: 'Reversal', pct: 6, color: '#a855f7' }],
    bestTimeframes: [{ label: '15m', pct: 71 }, { label: '1H', pct: 68 }, { label: '4H', pct: 60 }, { label: '1D', pct: 52 }],
    suitability: [{ label: 'Trending Market', stars: 3.5, bar: 70 }, { label: 'Ranging Market', stars: 1.5, bar: 30 }, { label: 'High Volatility', stars: 5, bar: 100 }, { label: 'Low Volatility', stars: 1, bar: 20 }, { label: 'High Volume', stars: 5, bar: 100 }, { label: 'Low Volume', stars: 1, bar: 20 }],
    marketFit: 81, health7: { trend: 82, alignment: 80, momentum: 90, volume: 92, stackScore: 84, stack: 84, risk: 78 },
    recent: { trades: 31, winRate: 65, profit: 6.4, avgRR: 1.92, series: choppy(3, 4, 30) },
  },
  {
    id: 'scalping-pro', name: 'Scalping Pro', tagline: 'High probability scalping', categories: ['Scalping', 'Momentum', 'Day Trading'],
    rating: 4.5, reviews: 185, winRate: 67, profitFactor: 1.92, bestMarket: 'High Volatility', difficulty: 'Advanced', bestTf: '1m - 15m', health: 79, sparkColor: '#a855f7', spark: choppy(14, 5, 24),
    dna: { trendStrength: 6.2, momentum: 9.2, riskReward: 6.8, easeOfUse: 5.4, winRate: 7.8, consistency: 6.6 },
    type: 'Scalping', idealTfs: '1m, 5m, 15m', avgHold: '3 - 30 Min', winRateHist: '67%', avgRR: '1 : 1.5', maxDD: '6.8%', volReq: 'High', volumeReq: 'High Liquidity', experience: 'Advanced', emotional: 'High', automation: 'Partial',
    quick: { totalTrades: 1284, winRate: 67.0, profitFactor: 1.92, avgRR: 1.48, netProfit: 17.2, maxDrawdown: 6.8, expectancy: 0.74, sharpe: 1.32 },
    bestMarkets: [{ label: 'Volatile', pct: 60, color: '#f0a020' }, { label: 'Trending', pct: 24, color: '#26A69A' }, { label: 'Ranging', pct: 12, color: '#f23645' }, { label: 'Reversal', pct: 4, color: '#a855f7' }],
    bestTimeframes: [{ label: '1m', pct: 66 }, { label: '5m', pct: 69 }, { label: '15m', pct: 64 }, { label: '1H', pct: 51 }],
    suitability: [{ label: 'Trending Market', stars: 3, bar: 60 }, { label: 'Ranging Market', stars: 3.5, bar: 70 }, { label: 'High Volatility', stars: 5, bar: 100 }, { label: 'Low Volatility', stars: 1.5, bar: 30 }, { label: 'High Volume', stars: 5, bar: 100 }, { label: 'Low Volume', stars: 0.5, bar: 10 }],
    marketFit: 72, health7: { trend: 70, alignment: 72, momentum: 88, volume: 90, stackScore: 76, stack: 76, risk: 70 },
    recent: { trades: 96, winRate: 66, profit: 5.1, avgRR: 1.48, series: choppy(2.5, 3, 30) },
  },
  {
    id: 'mean-reversion', name: 'Mean Reversion', tagline: 'Fade extremes, take profit', categories: ['Mean Reversion', 'Reversals', 'Day Trading'],
    rating: 4.2, reviews: 64, winRate: 58, profitFactor: 1.65, bestMarket: 'Ranging', difficulty: 'Medium', bestTf: '15m - 4H', health: 61, sparkColor: '#f0a020', spark: up(20, 9, 24),
    dna: { trendStrength: 4.2, momentum: 5.0, riskReward: 7.0, easeOfUse: 6.6, winRate: 6.4, consistency: 6.8 },
    type: 'Mean Reversion', idealTfs: '15m, 1H, 4H', avgHold: '1 - 12 Hours', winRateHist: '58%', avgRR: '1 : 1.7', maxDD: '11.4%', volReq: 'Low - Medium', volumeReq: 'Normal', experience: 'Intermediate', emotional: 'Medium', automation: 'Yes',
    quick: { totalTrades: 389, winRate: 58.0, profitFactor: 1.65, avgRR: 1.7, netProfit: 12.1, maxDrawdown: 11.4, expectancy: 0.52, sharpe: 1.02 },
    bestMarkets: [{ label: 'Ranging', pct: 58, color: '#26A69A' }, { label: 'Reversal', pct: 22, color: '#a855f7' }, { label: 'Volatile', pct: 12, color: '#f0a020' }, { label: 'Trending', pct: 8, color: '#f23645' }],
    bestTimeframes: [{ label: '15m', pct: 57 }, { label: '1H', pct: 60 }, { label: '4H', pct: 58 }, { label: '1D', pct: 49 }],
    suitability: [{ label: 'Trending Market', stars: 1, bar: 20 }, { label: 'Ranging Market', stars: 5, bar: 100 }, { label: 'High Volatility', stars: 2, bar: 40 }, { label: 'Low Volatility', stars: 4.5, bar: 90 }, { label: 'High Volume', stars: 2.5, bar: 50 }, { label: 'Low Volume', stars: 3.5, bar: 70 }],
    marketFit: 42, health7: { trend: 40, alignment: 44, momentum: 38, volume: 60, stackScore: 48, stack: 48, risk: 64 },
    recent: { trades: 19, winRate: 56, profit: 2.3, avgRR: 1.7, series: choppy(1, 3, 30) },
  },
];

export const STRATEGY_BY_ID = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<string, Strategy>;

// ---- Comparison (matches the design's three-row table) ----
export interface CompareRow { name: string; winRate: number; profitFactor: number; avgRR: number; maxDD: number; difficulty: Difficulty; }
export function comparisonRows(ids = ['trend-continuation', 'breakout', 'scalping-pro']): CompareRow[] {
  return ids.map((id) => { const s = STRATEGY_BY_ID[id]; return { name: s.name, winRate: s.winRate, profitFactor: s.profitFactor, avgRR: s.quick.avgRR, maxDD: s.quick.maxDrawdown, difficulty: s.difficulty }; });
}

// ---- Live Opportunity Scanner (representative ranked feed) ----
export interface Opportunity { strategy: string; symbol: string; tf: string; grade: 'High' | 'Medium' | 'Low'; health: number; color: string; }
export const OPPORTUNITIES: Opportunity[] = [
  { strategy: 'Trend Continuation', symbol: 'BTCUSDT', tf: '1H', grade: 'High', health: 92, color: '#26A69A' },
  { strategy: 'Trend Continuation', symbol: 'ETHUSDT', tf: '1H', grade: 'High', health: 88, color: '#26A69A' },
  { strategy: 'Breakout Strategy', symbol: 'SOLUSDT', tf: '15m', grade: 'Medium', health: 81, color: '#6aa6ff' },
  { strategy: 'Pullback Strategy', symbol: 'LINKUSDT', tf: '1H', grade: 'Medium', health: 76, color: '#f0a020' },
];

// ---- Learning Center ----
export interface Lesson { title: string; kind: 'Video' | 'Article' | 'Guide'; meta: string; }
export const LESSONS: Lesson[] = [
  { title: 'Trend Continuation Masterclass', kind: 'Video', meta: '24:15' },
  { title: 'Entry Timing for Trends', kind: 'Article', meta: '8 min read' },
  { title: 'Common Mistakes', kind: 'Guide', meta: '12 min read' },
];

export function rankStrategies(): Strategy[] {
  return [...STRATEGIES].sort((a, b) => b.health - a.health);
}
