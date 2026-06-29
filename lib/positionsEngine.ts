// Positions "Live Position Intelligence Center" engine. We do not yet have a
// live multi-symbol futures feed or stored open positions, so this builds a
// deterministic REPRESENTATIVE portfolio that the page renders faithfully (the
// page shows a "Representative" badge). The genuine, reusable pieces live here:
// the Position Health Score formula, the recommendation mapping, holding-time
// derivation and the portfolio aggregation, all pure + unit-tested.

export type Dir = 'Long' | 'Short';
export type Recommendation = 'Hold' | 'Watch' | 'Reduce' | 'Take Profit' | 'Exit';
export type Arrow = 'up' | 'down' | 'flat';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface HealthComponents { trend: number; alignment: number; momentum: number; volume: number; stackScore: number; risk: number; }

export interface PositionSeed {
  symbol: string; asset: string; direction: Dir;
  entry: number; current: number; leverage: number; marginUsed: number; units: number;
  rr: number; openedMinAgo: number; health: number;
  sl: number; tp1: number; tp2: number; tp3: number;
  mtf: Arrow[]; alignment: number;
}

export interface Position extends PositionSeed {
  priceMovePct: number; positionValue: number; unrealizedPnl: number; pnlPct: number;
  holdingMin: number; healthLabel: string; recommendation: Recommendation;
}

export interface PortfolioSummary {
  portfolioValue: number; todayPnl: number; todayPnlPct: number;
  openPnl: number; openPnlPct: number; openCount: number;
  marginUsed: number; marginUsedPct: number; freeMargin: number; freeMarginPct: number;
  longExposurePct: number; shortExposurePct: number;
}

export interface Portfolio { positions: Position[]; summary: PortfolioSummary; }

// ---- Position Health Score (spec weighting) ----
export const HEALTH_WEIGHTS: HealthComponents = { trend: 0.25, alignment: 0.2, momentum: 0.15, volume: 0.1, stackScore: 0.2, risk: 0.1 };
export function healthScore(c: HealthComponents): number {
  const v = c.trend * HEALTH_WEIGHTS.trend + c.alignment * HEALTH_WEIGHTS.alignment + c.momentum * HEALTH_WEIGHTS.momentum + c.volume * HEALTH_WEIGHTS.volume + c.stackScore * HEALTH_WEIGHTS.stackScore + c.risk * HEALTH_WEIGHTS.risk;
  return Math.max(0, Math.min(100, Math.round(v)));
}
export function healthLabel(h: number): string {
  if (h >= 90) return 'Elite';
  if (h >= 80) return 'Strong';
  if (h >= 60) return 'Stable';
  if (h >= 40) return 'Weak';
  return 'Exit';
}
export function recommendationFor(h: number): Recommendation {
  if (h >= 80) return 'Hold';
  if (h >= 60) return 'Watch';
  if (h >= 40) return 'Reduce';
  return 'Exit';
}

// Representative open portfolio (matches the design's six positions).
const SEEDS: PositionSeed[] = [
  { symbol: 'BTCUSDT', asset: 'BTC', direction: 'Long', entry: 62350.0, current: 63120.5, leverage: 10, marginUsed: 6235, units: 1, rr: 2.6, openedMinAgo: 272, health: 92, sl: 61200, tp1: 63000, tp2: 64200, tp3: 65800, mtf: ['up', 'up', 'up', 'up', 'up', 'down'], alignment: 5 },
  { symbol: 'ETHUSDT', asset: 'ETH', direction: 'Long', entry: 3420.15, current: 3520.3, leverage: 8, marginUsed: 4275.5, units: 10, rr: 1.85, openedMinAgo: 138, health: 88, sl: 3360, tp1: 3500, tp2: 3600, tp3: 3720, mtf: ['up', 'up', 'up', 'up', 'up', 'down'], alignment: 5 },
  { symbol: 'SOLUSDT', asset: 'SOL', direction: 'Long', entry: 148.6, current: 151.95, leverage: 6, marginUsed: 2477, units: 100, rr: 1.6, openedMinAgo: 65, health: 76, sl: 145.0, tp1: 152.0, tp2: 156.0, tp3: 162.0, mtf: ['up', 'up', 'up', 'up', 'flat', 'down'], alignment: 4 },
  { symbol: 'BNBUSDT', asset: 'BNB', direction: 'Long', entry: 582.1, current: 599.4, leverage: 5, marginUsed: 1164, units: 10, rr: 1.75, openedMinAgo: 192, health: 84, sl: 572.0, tp1: 600.0, tp2: 615.0, tp3: 635.0, mtf: ['up', 'up', 'up', 'up', 'up', 'down'], alignment: 5 },
  { symbol: 'XRPUSDT', asset: 'XRP', direction: 'Short', entry: 0.524, current: 0.5188, leverage: 5, marginUsed: 1048, units: 10000, rr: 1.2, openedMinAgo: 106, health: 72, sl: 0.532, tp1: 0.518, tp2: 0.508, tp3: 0.495, mtf: ['up', 'up', 'up', 'down', 'down', 'down'], alignment: 3 },
  { symbol: 'DOGEUSDT', asset: 'DOGE', direction: 'Long', entry: 0.1285, current: 0.1292, leverage: 3, marginUsed: 428, units: 10000, rr: 0.8, openedMinAgo: 45, health: 68, sl: 0.1262, tp1: 0.1295, tp2: 0.1315, tp3: 0.1350, mtf: ['up', 'up', 'up', 'down', 'down', 'down'], alignment: 3 },
];

function derive(s: PositionSeed): Position {
  const sign = s.direction === 'Long' ? 1 : -1;
  const priceMovePct = ((s.current - s.entry) / s.entry) * 100 * sign;
  const positionValue = s.marginUsed * s.leverage;
  const unrealizedPnl = s.units * (s.current - s.entry) * sign;
  const pnlPct = (unrealizedPnl / s.marginUsed) * 100;
  return {
    ...s, priceMovePct: +priceMovePct.toFixed(2), positionValue: +positionValue.toFixed(2),
    unrealizedPnl: +unrealizedPnl.toFixed(2), pnlPct: +pnlPct.toFixed(2), holdingMin: s.openedMinAgo,
    healthLabel: healthLabel(s.health), recommendation: recommendationFor(s.health),
  };
}

export function buildPortfolio(accountBalance = 28430.75, todayPnl = 741.65): Portfolio {
  const positions = SEEDS.map(derive);
  const longExp = positions.filter((p) => p.direction === 'Long').reduce((a, p) => a + p.positionValue, 0);
  const shortExp = positions.filter((p) => p.direction === 'Short').reduce((a, p) => a + p.positionValue, 0);
  const totalExp = longExp + shortExp || 1;
  const openPnl = +positions.reduce((a, p) => a + p.unrealizedPnl, 0).toFixed(2);
  const marginUsed = +positions.reduce((a, p) => a + p.marginUsed, 0).toFixed(2);
  const freeMargin = +(accountBalance - marginUsed).toFixed(2);
  return {
    positions,
    summary: {
      portfolioValue: +accountBalance.toFixed(2), todayPnl: +todayPnl.toFixed(2), todayPnlPct: +((todayPnl / accountBalance) * 100).toFixed(2),
      openPnl, openPnlPct: +((openPnl / accountBalance) * 100).toFixed(2), openCount: positions.length,
      marginUsed, marginUsedPct: +((marginUsed / accountBalance) * 100).toFixed(2),
      freeMargin, freeMarginPct: +((freeMargin / accountBalance) * 100).toFixed(2),
      longExposurePct: +((longExp / totalExp) * 100).toFixed(1), shortExposurePct: +((shortExp / totalExp) * 100).toFixed(1),
    },
  };
}

// ---- Scenario simulator (computed from the live portfolio) ----
export interface Scenario { label: string; value: number; }
export function scenarios(pf: Portfolio): Scenario[] {
  const btc = pf.positions.find((p) => p.symbol === 'BTCUSDT')!;
  const pnlAt = (p: Position, price: number) => p.units * (price - p.entry) * (p.direction === 'Long' ? 1 : -1);
  const btcTp2 = pnlAt(btc, btc.tp2) - btc.unrealizedPnl;
  const slAll = pf.positions.reduce((a, p) => a + (pnlAt(p, p.sl) - p.unrealizedPnl), 0);
  const drop5 = pf.positions.reduce((a, p) => a + (pnlAt(p, p.current * 0.95) - p.unrealizedPnl), 0);
  const rise5 = pf.positions.reduce((a, p) => a + (pnlAt(p, p.current * 1.05) - p.unrealizedPnl), 0);
  return [
    { label: 'If BTC reaches TP2', value: +btcTp2.toFixed(2) },
    { label: 'If Stop Loss Hit (All)', value: +slAll.toFixed(2) },
    { label: 'If Market Drops 5%', value: +drop5.toFixed(2) },
    { label: 'If Market Rises 5%', value: +rise5.toFixed(2) },
  ];
}

// ---- Portfolio risk (computed where clean, representative labels otherwise) ----
export interface RiskReport { level: RiskLevel; openRisk: number; openRiskPct: number; concentration: RiskLevel; maxDrawdownOpenPct: number; marginLevelPct: number; }
export function riskReport(pf: Portfolio): RiskReport {
  const openRisk = +pf.positions.reduce((a, p) => a + Math.abs(p.units * (p.entry - p.sl)), 0).toFixed(2);
  const equity = pf.summary.portfolioValue + pf.summary.openPnl;
  const marginLevelPct = +((equity / pf.summary.marginUsed) * 100).toFixed(2);
  const openRiskPct = +((openRisk / pf.summary.portfolioValue) * 100).toFixed(2);
  const topShare = Math.max(...pf.positions.map((p) => p.positionValue)) / pf.positions.reduce((a, p) => a + p.positionValue, 0);
  return {
    level: openRiskPct > 12 ? 'High' : openRiskPct > 6 ? 'Medium' : 'Low',
    openRisk, openRiskPct, concentration: topShare > 0.4 ? 'High' : topShare > 0.25 ? 'Medium' : 'Low',
    maxDrawdownOpenPct: -6.32, marginLevelPct,
  };
}

// ---- Correlation matrix (representative) ----
export const CORR_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'] as const;
export const CORRELATION: number[][] = [
  [1.0, 0.92, 0.88, 0.71, 0.63, 0.59],
  [0.92, 1.0, 0.86, 0.68, 0.61, 0.57],
  [0.88, 0.86, 1.0, 0.67, 0.58, 0.55],
  [0.71, 0.68, 0.67, 1.0, 0.49, 0.47],
  [0.63, 0.61, 0.58, 0.49, 1.0, 0.42],
  [0.59, 0.57, 0.55, 0.47, 0.42, 1.0],
];
export function highlyCorrelated(threshold = 0.85): string[] {
  const out: string[] = [];
  for (let i = 0; i < CORR_ASSETS.length; i++) for (let j = i + 1; j < CORR_ASSETS.length; j++) if (CORRELATION[i][j] >= threshold) out.push(CORR_ASSETS[i], CORR_ASSETS[j]);
  return [...new Set(out)];
}
