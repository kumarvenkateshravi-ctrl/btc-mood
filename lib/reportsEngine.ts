// Reports "Trading Intelligence Center" engine. The Reports page never computes
// trading signals; it consumes already-processed data. We don't have a real
// trade database yet, so this provides a deterministic REPRESENTATIVE monthly
// review (page shows a "Representative" badge) plus the genuine aggregation /
// grading helpers, all pure + unit-tested.

// Raw values + a render variant so the page renders them through the Num language
// (DESIGN.md §B5-FREEZE). `text` overrides the value display (e.g. Risk "Low").
export type KpiVariant = 'money' | 'pct' | 'plain' | 'score';
export interface Kpi {
  key: string; label: string;
  value: number; variant: KpiVariant; text?: string; sub?: string;
  delta?: number; deltaPercent?: boolean;
  kind: 'spark' | 'ring' | 'shield'; ringValue?: number; down?: boolean;
}
export const KPIS: Kpi[] = [
  { key: 'net', label: 'Net Profit', value: 18420.35, variant: 'money', delta: 18.42, deltaPercent: true, kind: 'spark' },
  { key: 'win', label: 'Win Rate', value: 73.2, variant: 'pct', delta: 6.21, deltaPercent: true, kind: 'spark' },
  { key: 'pf', label: 'Profit Factor', value: 2.46, variant: 'plain', delta: 0.32, kind: 'spark' },
  { key: 'exp', label: 'Expectancy', value: 42.31, variant: 'money', delta: 12.4, deltaPercent: true, kind: 'spark' },
  { key: 'sharpe', label: 'Sharpe Ratio', value: 1.86, variant: 'plain', delta: 0.22, kind: 'spark' },
  { key: 'dd', label: 'Max Drawdown', value: -8.41, variant: 'pct', delta: -1.32, deltaPercent: true, kind: 'spark', down: true },
  { key: 'disc', label: 'Discipline Score', value: 94, variant: 'score', delta: 8, kind: 'ring', ringValue: 94 },
  { key: 'risk', label: 'Risk Score', value: 22, variant: 'score', text: 'Low', sub: '22 / 100', kind: 'shield' },
];

const ramp = (a: number, b: number, n: number, noise = 0.05) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)) + Math.sin(i * 1.4) * (b - a) * noise);
export const PERF = {
  equity: ramp(0, 28430, 30), benchmark: ramp(0, 16824, 30, 0.07), buyhold: ramp(0, 12450, 30, 0.09),
  endLabels: { equity: '$28,430', benchmark: '$16,824', buyhold: '$12,450' },
  bottom: [
    { k: 'Best Day', v: '+$2,345.60', pos: true }, { k: 'Worst Day', v: '-$1,024.30', pos: false },
    { k: 'Winning Days', v: '21 (70%)', pos: true }, { k: 'Losing Days', v: '9 (30%)', pos: false },
    { k: 'Avg. Daily Return', v: '+0.72%', pos: true },
  ],
};

export interface AssetRow { asset: string; allocation: number; profit: number; contribution: number; color: string; }
export const PORTFOLIO: { total: number; rows: AssetRow[]; bottom: { k: string; v: string }[] } = {
  total: 28430.75,
  rows: [
    { asset: 'BTC', allocation: 40.2, profit: 7845.30, contribution: 42.6, color: '#f7931a' },
    { asset: 'ETH', allocation: 25.1, profit: 4521.10, contribution: 24.6, color: '#6aa6ff' },
    { asset: 'SOL', allocation: 14.8, profit: 2233.40, contribution: 12.1, color: '#26A69A' },
    { asset: 'BNB', allocation: 8.6, profit: 1208.20, contribution: 6.6, color: '#f0a020' },
    { asset: 'XRP', allocation: 5.1, profit: 612.35, contribution: 3.3, color: '#a855f7' },
    { asset: 'Others', allocation: 6.2, profit: 760.00, contribution: 4.0, color: '#8b93a7' },
  ],
  bottom: [{ k: 'Total Profit', v: '$18,420.35' }, { k: 'Total Return', v: '+184.20%' }, { k: 'Avg. Hold Time', v: '2d 14h' }, { k: 'Best Asset', v: 'BTC' }],
};

export interface StrategyRow { name: string; trades: number; winRate: number; profit: number; avgRR: number; pf: number; maxDD: number; }
export const STRATEGY_ROWS: StrategyRow[] = [
  { name: 'Trend Continuation', trades: 162, winRate: 74.6, profit: 7844.50, avgRR: 2.18, pf: 2.78, maxDD: -6.21 },
  { name: 'Pullback Strategy', trades: 128, winRate: 69.5, profit: 4624.32, avgRR: 1.92, pf: 2.24, maxDD: -7.14 },
  { name: 'Breakout Strategy', trades: 96, winRate: 64.6, profit: 2968.20, avgRR: 1.85, pf: 1.94, maxDD: -8.58 },
  { name: 'Scalping Pro', trades: 210, winRate: 64.1, profit: 2845.10, avgRR: 1.48, pf: 1.82, maxDD: -5.32 },
  { name: 'Mean Reversion', trades: 46, winRate: 56.5, profit: 312.12, avgRR: 1.21, pf: 1.32, maxDD: -9.41 },
];

export interface BandRow { band: string; trades: number; winRate: number; profit: number; avgRR: number; pf: number; tone: 'bull' | 'warn' | 'bear'; }
export const STACK_SCORE_ROWS: BandRow[] = [
  { band: '90 – 100', trades: 138, winRate: 82.4, profit: 7621.30, avgRR: 2.46, pf: 2.91, tone: 'bull' },
  { band: '80 – 89', trades: 176, winRate: 74.1, profit: 6234.50, avgRR: 2.02, pf: 2.33, tone: 'bull' },
  { band: '70 – 79', trades: 122, winRate: 62.3, profit: 2145.20, avgRR: 1.72, pf: 1.74, tone: 'bull' },
  { band: '60 – 69', trades: 64, winRate: 48.4, profit: -312.20, avgRR: 1.21, pf: 0.92, tone: 'warn' },
  { band: 'Below 60', trades: 28, winRate: 35.7, profit: -1258.45, avgRR: 0.88, pf: 0.61, tone: 'bear' },
];

export interface MtfRow { alignment: string; trades: number; winRate: number; profit: number; hold: string; pf: number; tone: 'bull' | 'warn' | 'bear'; }
export const MTF_ROWS: MtfRow[] = [
  { alignment: '6 / 6', trades: 156, winRate: 79.5, profit: 7321.80, hold: '1d 18h', pf: 2.71, tone: 'bull' },
  { alignment: '5 / 6', trades: 168, winRate: 71.2, profit: 5824.30, hold: '1d 10h', pf: 2.18, tone: 'bull' },
  { alignment: '4 / 6', trades: 132, winRate: 59.6, profit: 2342.10, hold: '20h 45m', pf: 1.62, tone: 'bull' },
  { alignment: '3 / 6', trades: 56, winRate: 45.1, profit: -124.60, hold: '12h 10m', pf: 0.98, tone: 'warn' },
  { alignment: '0 - 2 / 6', trades: 16, winRate: 31.3, profit: -1023.20, hold: '8h 20m', pf: 0.54, tone: 'bear' },
];

export interface RegimeRow { regime: string; occurrence: number; winRate: number; profit: number; pf: number; }
export const REGIME_ROWS: RegimeRow[] = [
  { regime: 'Bull Market', occurrence: 42, winRate: 76.8, profit: 8241.30, pf: 2.64 },
  { regime: 'Bear Market', occurrence: 18, winRate: 58.1, profit: 1812.20, pf: 1.86 },
  { regime: 'Ranging Market', occurrence: 30, winRate: 42.3, profit: 612.40, pf: 1.12 },
  { regime: 'High Volatility', occurrence: 24, winRate: 66.7, profit: 3442.20, pf: 2.18 },
  { regime: 'Low Volatility', occurrence: 26, winRate: 48.2, profit: 1204.25, pf: 1.31 },
];

export interface TfRow { tf: string; profit: number; winRate: number; hold: string; }
export const TIMEFRAME_ROWS: TfRow[] = [
  { tf: '5m', profit: 1245.30, winRate: 61.2, hold: '45m' },
  { tf: '15m', profit: 2850.10, winRate: 65.4, hold: '1h 15m' },
  { tf: '30m', profit: 4210.20, winRate: 69.7, hold: '2h 30m' },
  { tf: '1H', profit: 6842.40, winRate: 73.2, hold: '5h 40m' },
  { tf: '4H', profit: 3124.60, winRate: 75.1, hold: '18h 20m' },
  { tf: '1D', profit: 321.75, winRate: 68.3, hold: '2d 14h' },
];

export const RISK = {
  metrics: [
    { k: 'Average Risk per Trade', v: '1.18%' }, { k: 'Largest Single Risk', v: '2.00%' },
    { k: 'Risk Concentration', v: 'Medium' }, { k: 'Exposure (Long / Short)', v: '68% / 32%' },
    { k: 'Max Drawdown', v: '-8.41%' }, { k: 'Recovery Time', v: '9 Days' },
  ],
  score: 22, label: 'Low Risk',
};

export interface EmotionBar { label: string; winRate: number; color: string; }
export const EMOTIONS: EmotionBar[] = [
  { label: 'Calm', winRate: 81, color: '#26A69A' }, { label: 'Confident', winRate: 76, color: '#6aa6ff' },
  { label: 'Focused', winRate: 72, color: '#2dd4bf' }, { label: 'Excited', winRate: 48, color: '#f0a020' },
  { label: 'Fearful', winRate: 33, color: '#f2683c' }, { label: 'FOMO', winRate: 22, color: '#a855f7' },
  { label: 'Angry', winRate: 18, color: '#f23645' },
];

export const DISCIPLINE = {
  score: 94, label: 'Excellent',
  checks: [
    { k: 'Followed Plan', v: 92 }, { k: 'Respected Stop Loss', v: 96 }, { k: 'Did Not Move SL', v: 94 },
    { k: 'Risk Under 2%', v: 97 }, { k: 'Checklist Followed', v: 91 }, { k: 'No Revenge Trading', v: 98 }, { k: 'No Overtrading', v: 90 },
  ],
};

export interface MistakeRow { mistake: string; frequency: number; cost: number; }
export const MISTAKES: MistakeRow[] = [
  { mistake: 'Exited Early', frequency: 42, cost: -3246.20 },
  { mistake: 'Moved Stop Loss', frequency: 28, cost: -2120.15 },
  { mistake: 'FOMO Entries', frequency: 16, cost: -1430.80 },
  { mistake: 'Overtrading', frequency: 12, cost: -980.40 },
  { mistake: 'Ignored Trend', frequency: 9, cost: -720.20 },
  { mistake: 'Revenge Trading', frequency: 6, cost: -610.15 },
];

export const AI_COACH: { text: string; tone: 'bull' | 'warn' | 'info' }[] = [
  { text: 'Your best performing strategy is Trend Continuation.', tone: 'bull' },
  { text: 'You perform 81% better in trending markets.', tone: 'bull' },
  { text: 'Avoid trading after 3 consecutive losses.', tone: 'warn' },
  { text: 'Increase holding time on 1H setups.', tone: 'info' },
  { text: 'Your discipline improved 18% this month.', tone: 'bull' },
];

export interface MissedRow { opportunity: string; symbol: string; setup: string; missedOn: string; potential: string; profit: string; }
export const MISSED: MissedRow[] = [
  { opportunity: 'Trend Continuation', symbol: 'SOLUSDT', setup: 'Jun 18', missedOn: '+12.4%', potential: '+$1,248', profit: '+$1,248' },
  { opportunity: 'Breakout Strategy', symbol: 'LINKUSDT', setup: 'Jun 22', missedOn: '+8.7%', potential: '+$820', profit: '+$820' },
  { opportunity: 'Pullback Setup', symbol: 'ETHUSDT', setup: 'Jun 25', missedOn: '+9.3%', potential: '+$732', profit: '+$732' },
];

export interface GoalRow { label: string; current: string; target: string; progress: number; }
export const GOALS: GoalRow[] = [
  { label: 'Monthly Profit', current: '$18,420', target: '$15,000', progress: 122 },
  { label: 'Win Rate', current: '73.2%', target: '70%', progress: 104 },
  { label: 'Max Drawdown', current: '8.41%', target: '10%', progress: 84 },
  { label: 'Trade Count', current: '642', target: '600', progress: 107 },
  { label: 'Discipline Score', current: '94', target: '85', progress: 111 },
];

// Calendar bucket: 2 = >+1%, 1 = 0..+1%, -1 = -1..0%, -2 = <-1%, 0 = no trades
export const CALENDAR: number[][] = [
  [2, 1, -1, 2, 2, 0, 0],
  [1, 2, 2, -2, 1, 2, 0],
  [2, -1, 2, 2, 1, -1, 0],
  [2, 2, 1, 2, -2, 2, 0],
  [1, 2, 2, -1, 2, 0, 0],
];

export interface ExportRow { name: string; format: 'PDF' | 'CSV' | 'Excel'; }
export const EXPORTS: ExportRow[] = [
  { name: 'Performance Report', format: 'PDF' }, { name: 'Tax Report', format: 'CSV' },
  { name: 'Trade History', format: 'Excel' }, { name: 'Strategy Report', format: 'PDF' },
  { name: 'Journal Report', format: 'PDF' }, { name: 'Backtest Report', format: 'Excel' },
];

export const EXEC_SUMMARY = {
  title: 'June 2025 Performance Summary',
  body: 'You had an excellent month with strong performance across trending markets. Your wins were larger than your losses, and your discipline improved significantly.',
  stats: [
    { k: 'Net Return', v: '+18.42%', pos: true }, { k: 'Win Rate', v: '73.2%', pos: true },
    { k: 'Profit Factor', v: '2.46', pos: true }, { k: 'Max DD', v: '-8.41%', pos: false },
  ],
  bestStrategy: 'Trend Continuation', discipline: '+18%', grade: 'A',
};

export const SAVED_REPORTS = ['My Monthly Review', 'My Funded Account Report', 'Weekly Scalping Report', 'Strategy Comparison Report'];

export const ACCOUNT_OVERVIEW = [
  { k: 'Account Value', v: '$28,430.75' }, { k: 'Net Profit', v: '$18,420.35', pos: true },
  { k: 'Total Return', v: '+184.20%', pos: true }, { k: 'Available Balance', v: '$8,156.20' }, { k: 'Margin Used', v: '28.6%' },
];

export const TABS = ['Executive', 'Performance', 'Strategies', 'Risk', 'Behavior', 'Goals', 'Calendar', 'Exports', 'Custom Reports'];

// ---- genuine helpers (tested) ----
export function gradeForScore(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
export function totalStrategyProfit(rows = STRATEGY_ROWS): number {
  return +rows.reduce((a, r) => a + r.profit, 0).toFixed(2);
}
export function bestStrategy(rows = STRATEGY_ROWS): StrategyRow {
  return [...rows].sort((a, b) => b.profit - a.profit)[0];
}
export function allocationSum(rows = PORTFOLIO.rows): number {
  return +rows.reduce((a, r) => a + r.allocation, 0).toFixed(1);
}
