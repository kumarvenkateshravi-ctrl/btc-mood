// Alerts engine — the "market monitoring" brain. Pure functions: the Smart Alert
// Quality Score (the moat formula), per-alert condition evaluation against a live
// market snapshot, and severity/category helpers. No DB; the store persists rules
// in localStorage and the page evaluates them against the live engines.

export type AlertType =
  | 'Stack Score' | 'MTF Alignment' | 'Trade Setup' | 'Scanner'
  | 'Market Regime' | 'Risk Alert' | 'Exit' | 'Price Action' | 'Watchlist';
export type Condition = 'Greater Than' | 'Less Than' | 'Crosses Above' | 'Crosses Below' | 'Changes By';
export type Severity = 'Opportunity' | 'Watch' | 'Action' | 'Critical';
export type AlertStatus = 'Active' | 'Paused';

export interface AlertFilters {
  timeframe?: string;
  regime?: string;
  volume?: string;
  minProbability?: number;
  cooldownMin?: number;
}

export interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  condition: Condition;
  threshold: number;
  severity: Severity;
  status: AlertStatus;
  createdAt: number;
  lastTriggered: number | null;
  filters?: AlertFilters;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  stackScore: number;
  consensusBull: number;
  consensusTotal: number;
  tradeReadiness: number;
  probability: number;
  volumeScore: number;
  trendScore: number;
  alignmentScore: number; // consensus as 0–100
}

export interface TriggeredAlert {
  id: string;
  at: number;
  symbol: string;
  type: AlertType;
  severity: Severity;
  title: string;
  detail: string;
  score: number;
}

export const ALERT_TYPES: AlertType[] = ['Stack Score', 'MTF Alignment', 'Trade Setup', 'Scanner', 'Market Regime', 'Risk Alert', 'Exit', 'Price Action', 'Watchlist'];
export const CONDITIONS: Condition[] = ['Greater Than', 'Less Than', 'Crosses Above', 'Crosses Below', 'Changes By'];
export const SEVERITIES: Severity[] = ['Opportunity', 'Watch', 'Action', 'Critical'];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Smart Alert Quality Score (the moat). Only high-quality conditions are worth
 * a notification: quality = score*0.3 + alignment*0.25 + volume*0.15 +
 * probability*0.2 + trend*0.1.
 */
export function alertQualityScore(m: { score: number; alignment: number; volume: number; probability: number; trend: number }): number {
  return Math.round(clamp(m.score * 0.3 + m.alignment * 0.25 + m.volume * 0.15 + m.probability * 0.2 + m.trend * 0.1, 0, 100));
}

export function qualityLabel(q: number): string {
  return q >= 85 ? 'High Quality Alert' : q >= 70 ? 'Good Quality Alert' : q >= 50 ? 'Moderate Alert' : 'Low Quality Alert';
}

/** The live numeric value an alert is watching, by type. */
export function alertValue(alert: Alert, snap: MarketSnapshot): number {
  switch (alert.type) {
    case 'Stack Score':
    case 'Scanner':
      return snap.stackScore;
    case 'MTF Alignment':
    case 'Risk Alert':
    case 'Exit':
      return snap.consensusBull;
    case 'Trade Setup':
      return snap.tradeReadiness;
    case 'Price Action':
      return snap.price;
    default:
      return snap.stackScore;
  }
}

export function conditionMet(condition: Condition, value: number, threshold: number): boolean {
  switch (condition) {
    case 'Greater Than':
    case 'Crosses Above':
      return value > threshold;
    case 'Less Than':
    case 'Crosses Below':
      return value < threshold;
    case 'Changes By':
      return Math.abs(value - threshold) >= threshold;
    default:
      return false;
  }
}

/** Evaluate one active alert against the snapshot. */
export function evaluateAlert(alert: Alert, snap: MarketSnapshot): { fires: boolean; value: number; title: string; detail: string } {
  const value = alertValue(alert, snap);
  const fires = alert.status === 'Active' && conditionMet(alert.condition, value, alert.threshold);
  const { title, detail } = describe(alert, snap, value);
  return { fires, value, title, detail };
}

function describe(alert: Alert, snap: MarketSnapshot, value: number): { title: string; detail: string } {
  switch (alert.type) {
    case 'Stack Score':
      return { title: `Stack Score ${alert.condition.includes('Less') ? 'dropped' : 'crossed'} ${alert.threshold}`, detail: `Now ${Math.round(value)}/100` };
    case 'MTF Alignment':
      return { title: `${snap.consensusBull}/${snap.consensusTotal} timeframe alignment`, detail: snap.consensusBull >= snap.consensusTotal ? 'All timeframes aligned' : 'Alignment shifting' };
    case 'Trade Setup':
      return { title: 'Entry zone / readiness reached', detail: `Execution readiness ${Math.round(snap.tradeReadiness)}/100` };
    case 'Risk Alert':
      return { title: 'Alignment dropped', detail: `${snap.consensusBull}/${snap.consensusTotal} timeframes (review position)` };
    case 'Exit':
      return { title: 'Exit condition met', detail: `Alignment ${snap.consensusBull}/${snap.consensusTotal}` };
    case 'Price Action':
      return { title: `Price ${alert.condition.includes('Less') ? 'below' : 'above'} ${alert.threshold}`, detail: `Now ${Math.round(snap.price)}` };
    default:
      return { title: `${alert.type} condition`, detail: `Value ${Math.round(value)}` };
  }
}

let seedCounter = 0;
const uid = () => `${Date.now().toString(36)}-${(seedCounter++).toString(36)}`;

/** Example active alerts to seed an empty store (mirrors the reference). */
export function seedAlerts(): Alert[] {
  const now = Date.now();
  const mk = (symbol: string, type: AlertType, condition: Condition, threshold: number, severity: Severity, agoMin: number): Alert => ({
    id: uid(), symbol, type, condition, threshold, severity, status: 'Active', createdAt: now - agoMin * 60_000, lastTriggered: null,
  });
  return [
    mk('BTCUSDT', 'Stack Score', 'Greater Than', 85, 'Opportunity', 600),
    mk('BTCUSDT', 'MTF Alignment', 'Greater Than', 5, 'Opportunity', 480),
    mk('ETHUSDT', 'Trade Setup', 'Greater Than', 80, 'Action', 360),
    mk('SOLUSDT', 'Stack Score', 'Greater Than', 90, 'Opportunity', 320),
    mk('BTCUSDT', 'Risk Alert', 'Less Than', 4, 'Critical', 280),
    mk('ETHUSDT', 'Price Action', 'Greater Than', 3450, 'Watch', 250),
  ];
}
